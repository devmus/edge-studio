import http.client
import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("script_helper", Path(__file__).resolve().parents[1] / "edge_studio_script_helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "scripts"
        self.root.mkdir()
        self.state = Path(self.temp.name) / "state"
        self.runner = helper.Runner(self.root, self.state)
        self.runner.reconcile({"session": "test", "owners": []})
        self.addCleanup(self.runner.close)

    def script(self, source, capabilities=None):
        folder = self.root / "test-script"
        folder.mkdir(exist_ok=True)
        (folder / "main.py").write_text(source)
        (folder / "script.json").write_text(json.dumps({"id": folder.name, "name": "Test", "capabilities": capabilities or []}))
        return folder

    def run_script(self, **kwargs):
        return self.runner.run({"workflowId": "workflow", "blockId": "block", "runId": "run", "scriptId": "test-script", "session": "test", **kwargs})

    def finished(self, job_id):
        limit = time.monotonic() + 8
        while time.monotonic() < limit:
            job = self.runner.get(job_id)
            if job["status"] not in helper.LIVE:
                return job
            time.sleep(0.02)
        self.fail("Script did not finish")

    def test_real_python_inputs_results_and_minimal_environment(self):
        self.script('import os\nfrom edge_script import inputs, result\nresult({"inputs": inputs(), "secret": os.getenv("APP_SECRET"), "data": bool(os.getenv("EDGE_SCRIPT_DATA_DIR"))})\n')
        with patch.dict(os.environ, {"APP_SECRET": "private-parent-secret"}):
            job = self.finished(self.run_script(inputs={"lux": 12.5})["job"]["id"])
        self.assertEqual(job["status"], "success")
        self.assertEqual(job["result"], {"inputs": {"lux": 12.5}, "secret": None, "data": True})

    def test_manifest_paths_symlinks_and_invalid_configs(self):
        folder = self.script('pass')
        for script_id in ("../test-script", "/tmp/code", "test_script"):
            with self.assertRaises(ValueError):
                self.runner.manifest(script_id)
        (folder / "main.py").unlink()
        (folder / "main.py").symlink_to(Path(__file__))
        self.assertEqual(self.runner.scripts()["items"], [])
        self.assertEqual(len(self.runner.scripts()["errors"]), 1)

    def test_manifest_normalizes_legacy_display_access_and_rejects_unknown_capabilities(self):
        folder = self.script('pass', ["display"])
        self.assertEqual(self.runner.manifest("test-script")["capabilities"], ["display.frames"])
        (folder / "script.json").write_text(json.dumps({"id": folder.name, "capabilities": ["gpio"]}))
        with self.assertRaisesRegex(ValueError, "display.frames"):
            self.runner.manifest("test-script")

    def test_failure_timeout_log_limits_and_invalid_modes(self):
        self.script('raise RuntimeError("script failed")')
        job = self.finished(self.run_script()["job"]["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("script failed", job["logs"])
        self.script('import time\ntime.sleep(60)')
        job = self.finished(self.run_script(timeoutSeconds=1)["job"]["id"])
        self.assertEqual(job["status"], "timed_out")
        self.script('print("a" * 17000)\nimport time\ntime.sleep(60)')
        job = self.finished(self.run_script()["job"]["id"])
        self.assertEqual(job["status"], "failed")
        self.assertLessEqual(len(job["logs"]), 16384)
        for config in ({"mode": "other"}, {"timeoutSeconds": 0}, {"inputs": "a" * 17000}, {"mode": "bounded", "timeoutSeconds": None}):
            with self.assertRaises(ValueError):
                self.run_script(**config)

    def test_background_keep_update_restart_and_stop(self):
        self.script('from edge_script import inputs, result\nimport time\nwhile True:\n value = inputs()\n result(value)\n')
        first = self.run_script(mode="background", timeoutSeconds=None, inputs={"lux": 1})["job"]
        self.assertEqual(self.run_script(mode="background")["job"]["id"], first["id"])
        update = self.run_script(mode="background", onRunning="update", inputs={"lux": 2})
        self.assertEqual(update["action"], "updated")
        for _ in range(100):
            if self.runner.get(first["id"])["result"] == {"lux": 2}:
                break
            time.sleep(0.02)
        self.assertEqual(self.runner.get(first["id"])["result"], {"lux": 2})
        second = self.run_script(mode="background", onRunning="restart")["job"]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.runner.get(first["id"])["status"], "stopped")
        self.runner.stop(second["id"])
        self.assertEqual(self.runner.get(second["id"])["status"], "stopped")

    def test_reconciliation_stops_removed_owners_and_restart_interrupts(self):
        self.script('import time\ntime.sleep(60)')
        first = self.run_script(mode="background")["job"]
        self.runner.reconcile({"session": "test", "owners": []})
        self.assertEqual(self.runner.get(first["id"])["status"], "stopped")
        second = self.run_script(mode="background")["job"]
        self.runner.reconcile({"session": "new-backend", "owners": []})
        self.assertEqual(self.runner.get(second["id"])["status"], "interrupted")

    def test_restart_marks_persisted_running_jobs_interrupted(self):
        record = {"id": "old-job", "status": "running"}
        self.runner.save(record)
        other = helper.Runner(self.root, self.state)
        try:
            self.assertEqual(other.get("old-job")["status"], "interrupted")
        finally:
            other.close()

    def test_orphan_heartbeat_expires_background_job(self):
        self.script('import time\ntime.sleep(60)')
        job = self.run_script(mode="background")["job"]
        self.runner.heartbeat = time.monotonic() - 46
        self.assertEqual(self.finished(job["id"])["status"], "interrupted")

    def test_timeout_stops_descendant_processes_in_the_job_group(self):
        self.script("""import os, subprocess, sys, time
child = '''import os, pathlib, signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
p = pathlib.Path(os.environ["EDGE_SCRIPT_DATA_DIR"]) / "heartbeat"
while True:
 p.write_text(str(time.time()))
 time.sleep(0.05)
'''
subprocess.Popen([sys.executable, "-c", child])
time.sleep(60)
""")
        job = self.finished(self.run_script(timeoutSeconds=1)["job"]["id"])
        self.assertEqual(job["status"], "timed_out")
        marker = self.state / "data" / "test-script" / "heartbeat"
        value = marker.read_text()
        time.sleep(0.2)
        self.assertEqual(marker.read_text(), value)

    def test_frame_broker_owns_session_and_never_passes_token_to_script(self):
        self.script('from edge_script import result\nresult(42)', ["display.frames"])
        with self.assertRaisesRegex(ValueError, "PIM576"):
            self.run_script()
        with patch.object(self.runner, "display_request", return_value={"ok": True}) as broker:
            job = self.finished(self.run_script(display={"model": "pim576", "rotation": 90})["job"]["id"])
        self.assertEqual(job["status"], "success")
        self.assertEqual(broker.call_args_list[0].args[0], "/session")
        self.assertEqual(broker.call_args_list[-1].args[0], "/session/release")

    def test_http_auth_unknown_endpoints_and_request_limits(self):
        self.script('pass')
        class Handler(helper.Handler):
            runner = self.runner
            token = "test-token"
        server = helper.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(path, token=None, body=None):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            headers = {"Authorization": "Bearer " + token} if token else {}
            connection.request("GET" if body is None else "POST", path, body, headers)
            response = connection.getresponse()
            data = json.loads(response.read())
            connection.close()
            return response.status, data
        self.assertEqual(request("/scripts")[0], 401)
        self.assertEqual(request("/scripts", Handler.token)[1]["items"][0]["id"], "test-script")
        self.assertEqual(request("/shell", Handler.token, "{}")[0], 404)
        self.assertEqual(request("/run", Handler.token, "x" * 32769)[0], 400)

    def test_http_filters_history_before_the_recent_job_limit(self):
        for index in range(105):
            self.runner.save({"id": f"job-{index}", "workflowId": "workflow", "blockId": "block", "runId": f"run-{index}", "status": "success", "logs": "log"})
        class Handler(helper.Handler):
            runner = self.runner
            token = "test-token"
        server = helper.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(query):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            connection.request("GET", "/jobs" + query, headers={"Authorization": "Bearer test-token"})
            response = connection.getresponse()
            data = json.loads(response.read())
            connection.close()
            self.assertEqual(response.status, 200)
            return data["items"]
        self.assertEqual(len(request("")), 100)
        self.assertEqual([job["id"] for job in request("?workflowId=workflow&runId=run-0&blockId=block")], ["job-0"])
        self.assertEqual(request("?runId=run-0&blockId=other-block"), [])


if __name__ == "__main__":
    unittest.main()
