#!/usr/bin/env python3
"""Opt-in runner for trusted, operator-installed Python. Not a Python sandbox."""
import base64
import hmac
import json
import os
import queue
import re
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import parse_qs, urlsplit
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ID = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
LIVE = ("starting", "running")
TERMINAL = ("success", "failed", "stopped", "timed_out", "interrupted")
MAX_INPUT = 16384
MAX_LOG = 16384
MAX_LINE = 240000


def encoded(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":"))


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Invalid script ID")
    return value


class Runner:
    def __init__(self, root, state, display_url="", display_token=""):
        self.root = Path(root).resolve()
        self.state = Path(state)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.state / "jobs.db", check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, record TEXT NOT NULL)")
        self.db.commit()
        self.active = {}
        self.threads = []
        self.session = None
        self.heartbeat = time.monotonic()
        self.display_url = display_url.rstrip("/")
        self.display_token = display_token
        for job in self.jobs():
            if job["status"] in LIVE:
                job.update(status="interrupted", error="Runner restarted; job was not resumed", finishedAt=time.time())
                self.save(job)

    def manifest(self, script_id):
        script_id = identifier(script_id)
        folder = self.root / script_id
        manifest = folder / "script.json"
        entry = folder / "main.py"
        if folder.is_symlink() or manifest.is_symlink() or entry.is_symlink():
            raise ValueError("Script directories, manifests and entry points must not be symlinks")
        if not folder.is_dir() or not manifest.is_file() or not entry.is_file():
            raise ValueError("Script requires script.json and main.py")
        if manifest.stat().st_size > MAX_INPUT:
            raise ValueError("Script manifest is too large")
        config = json.loads(manifest.read_text(encoding="utf-8"))
        if not isinstance(config, dict) or config.get("id") != script_id or config.get("entrypoint", "main.py") != "main.py":
            raise ValueError("Manifest ID must match its directory; entrypoint must be main.py")
        name = config.get("name", script_id)
        capabilities = config.get("capabilities", [])
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ValueError("Script name must contain 1 to 100 characters")
        if not isinstance(capabilities, list) or any(item != "display" for item in capabilities):
            raise ValueError("Supported capability: display")
        return {"id": script_id, "name": name, "capabilities": capabilities}

    def scripts(self):
        items, errors = [], []
        if self.root.is_dir():
            for folder in sorted(self.root.iterdir()):
                if folder.is_dir() or folder.is_symlink():
                    try:
                        items.append(self.manifest(folder.name))
                    except (ValueError, OSError):
                        errors.append({"id": folder.name, "error": "Invalid script; check its manifest, entry point and permissions"})
        return {"items": items, "errors": errors}

    def save(self, job):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO jobs VALUES (?, ?)", (job["id"], encoded(job)))
            self.db.execute("DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY rowid DESC LIMIT 1000) AND json_extract(record, '$.status') NOT IN ('running', 'starting')")
            self.db.commit()

    def jobs(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute("SELECT record FROM jobs ORDER BY rowid DESC LIMIT 1000")]

    def get(self, job_id):
        with self.lock:
            row = self.db.execute("SELECT record FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise ValueError("Job not found")
            return json.loads(row[0])

    def display_request(self, path, body):
        if not self.display_url or not self.display_token:
            raise ValueError("Display support is not configured for the script runner")
        request = urllib.request.Request(self.display_url + path, encoded(body).encode(),
                                         {"Authorization": "Bearer " + self.display_token, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read(4096))

    def run(self, payload):
        manifest = self.manifest(payload.get("scriptId"))
        mode = payload.get("mode", "bounded")
        policy = payload.get("onRunning", "keep")
        timeout = payload.get("timeoutSeconds", 30 if mode == "bounded" else None)
        if mode not in ("bounded", "background") or policy not in ("keep", "restart", "update"):
            raise ValueError("Invalid execution mode or repeated-trigger policy")
        if timeout is not None and (type(timeout) not in (int, float) or not 1 <= timeout <= 3600):
            raise ValueError("Time limit must be 1 to 3600 seconds")
        if mode == "bounded" and timeout is None:
            raise ValueError("Bounded scripts require a time limit")
        inputs = payload.get("inputs", {})
        if len(encoded(inputs).encode()) > MAX_INPUT:
            raise ValueError("Script inputs exceed 16 KiB")
        owner = (payload.get("workflowId"), payload.get("blockId"))
        if any(not isinstance(part, str) or not part or len(part) > 100 for part in owner):
            raise ValueError("Workflow and block IDs are required")
        if not isinstance(payload.get("session"), str) or payload["session"] != self.session:
            raise ValueError("Backend session has not been reconciled")
        display = payload.get("display")
        if "display" in manifest["capabilities"]:
            if not isinstance(display, dict) or display.get("model") != "pim576" or type(display.get("rotation")) is not int or display["rotation"] not in (0, 90, 180, 270):
                raise ValueError("This script requires a configured PIM576 display")
        elif display is not None:
            raise ValueError("Script does not declare display capability")
        with self.lock:
            existing = next((job for job in self.active.values() if (job["record"]["workflowId"], job["record"]["blockId"]) == owner), None)
            if existing:
                if mode != "background" or existing["record"]["mode"] != "background":
                    raise ValueError("This block already has an active job")
                if policy != "restart" and existing["record"]["scriptId"] != manifest["id"]:
                    raise ValueError("Stop or restart the running job before changing scripts")
                if policy == "update":
                    try:
                        existing["inputs"].put_nowait(inputs)
                    except queue.Full:
                        raise ValueError("Script input queue is full") from None
                    return {"job": self.get(existing["record"]["id"]), "action": "updated"}
                if policy == "keep":
                    return {"job": self.get(existing["record"]["id"]), "action": "kept"}
                self.stop(existing["record"]["id"])
            if len(self.active) >= 4:
                raise ValueError("At most four scripts can run concurrently")
            job_id = str(uuid.uuid4())
            record = {"id": job_id, "workflowId": owner[0], "blockId": owner[1], "runId": payload.get("runId"),
                      "scriptId": manifest["id"], "mode": mode, "status": "starting", "startedAt": time.time(),
                      "finishedAt": None, "result": None, "logs": "", "error": None}
            folder = self.root / manifest["id"]
            python = folder / ".venv" / "bin" / "python"
            data = self.state / "data" / manifest["id"]
            data.mkdir(parents=True, exist_ok=True, mode=0o700)
            child_env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONUNBUFFERED": "1",
                         "PYTHONPATH": str(Path(__file__).resolve().parent), "EDGE_SCRIPT_DATA_DIR": str(data.resolve())}
            if display is not None:
                self.display_request("/session", {"owner": job_id, "config": display})
            try:
                process = subprocess.Popen([str(python) if python.is_file() else sys.executable, str(folder / "main.py")],
                                           cwd=folder, env=child_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=subprocess.STDOUT, start_new_session=True)
            except Exception:
                if display is not None:
                    self.display_request("/session/release", {"owner": job_id})
                raise
            record["status"] = "running"
            live = {"record": record, "process": process, "inputs": queue.Queue(maxsize=8),
                    "stop": threading.Event(), "error": None, "display": display, "lastFrame": 0.0}
            live["inputs"].put(inputs)
            self.active[job_id] = live
            self.save(record)
            thread = threading.Thread(target=self.monitor, args=(live, timeout), daemon=True)
            self.threads = [item for item in self.threads if item.is_alive()]
            self.threads.append(thread)
            thread.start()
            return {"job": dict(record), "action": "started"}

    def write_inputs(self, live):
        try:
            while not live["stop"].is_set():
                try:
                    inputs = live["inputs"].get(timeout=0.1)
                except queue.Empty:
                    continue
                live["process"].stdin.write((encoded(inputs) + "\n").encode())
                live["process"].stdin.flush()
        except (OSError, ValueError):
            pass

    def read_output(self, live):
        try:
            while True:
                line = live["process"].stdout.readline(MAX_LINE + 1)
                if not line:
                    return
                if len(line) > MAX_LINE:
                    raise ValueError("Script output line exceeds the limit")
                text = line.decode("utf-8", errors="replace").rstrip()
                try:
                    event = json.loads(text)
                except ValueError:
                    event = {"type": "log", "message": text}
                if not isinstance(event, dict):
                    event = {"type": "log", "message": text}
                kind = event.get("type", "log")
                if kind == "frame":
                    if live["display"] is None:
                        raise ValueError("Script has no display session")
                    frame = event.get("rgb")
                    if not isinstance(frame, str) or len(base64.b64decode(frame, validate=True)) != 240 * 240 * 3:
                        raise ValueError("Frames must contain exactly 240x240 RGB pixels")
                    delay = 0.05 - (time.monotonic() - live["lastFrame"])
                    if delay > 0:
                        live["stop"].wait(delay)
                    if live["stop"].is_set():
                        return
                    self.display_request("/frame", {"owner": live["record"]["id"], "rgb": frame})
                    live["lastFrame"] = time.monotonic()
                else:
                    with self.lock:
                        record = live["record"]
                        if kind == "result":
                            value = event.get("value")
                            if len(encoded(value).encode()) > MAX_INPUT:
                                raise ValueError("Script result exceeds 16 KiB")
                            record["result"] = value
                        else:
                            message = str(event.get("message", text))
                            if len(record["logs"].encode()) + len(message.encode()) + 1 > MAX_LOG:
                                raise ValueError("Script logs exceed 16 KiB")
                            record["logs"] += message + "\n"
                        self.save(record)
        except Exception:
            live["error"] = "Script output or display update failed; check the script protocol and display support"

    @staticmethod
    def terminate(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def monitor(self, live, timeout):
        process, record = live["process"], live["record"]
        reader = threading.Thread(target=self.read_output, args=(live,), daemon=True)
        writer = threading.Thread(target=self.write_inputs, args=(live,), daemon=True)
        reader.start()
        writer.start()
        started, refreshed = time.monotonic(), time.monotonic()
        status = "success"
        while process.poll() is None:
            if live["stop"].wait(0.05):
                status = "stopped"
                break
            if live["error"]:
                status = "failed"
                break
            if timeout is not None and time.monotonic() - started >= timeout:
                status = "timed_out"
                break
            if time.monotonic() - self.heartbeat > 45:
                status = "interrupted"
                break
            if live["display"] is not None and time.monotonic() - refreshed > 5:
                try:
                    self.display_request("/session", {"owner": record["id"], "config": live["display"]})
                    refreshed = time.monotonic()
                except Exception:
                    live["error"] = "Display session could not be renewed"
        self.terminate(process)
        process.wait()
        reader.join(timeout=6)
        live["stop"].set()
        writer.join(timeout=2)
        process.stdin.close()
        process.stdout.close()
        if live["display"] is not None:
            try:
                self.display_request("/session/release", {"owner": record["id"]})
            except Exception:
                pass
        with self.lock:
            if record["status"] in TERMINAL:
                status = record["status"]
            if status == "success" and (process.returncode != 0 or live["error"]):
                status = "failed"
            record.update(status=status, finishedAt=time.time(), exitCode=process.returncode,
                          error=live["error"] or (None if status == "success" else "Script " + status))
            self.save(record)
            self.active.pop(record["id"], None)

    def stop(self, job_id, status="stopped"):
        with self.lock:
            live = self.active.get(job_id)
            if live:
                live["stop"].set()
                self.terminate(live["process"])
                live["record"].update(status=status, finishedAt=time.time(), error="Script " + status)
                self.save(live["record"])
                self.active.pop(job_id, None)
                if live["display"] is not None:
                    try:
                        self.display_request("/session/release", {"owner": job_id})
                    except Exception:
                        pass
            return self.get(job_id)

    def reconcile(self, payload):
        session = payload.get("session")
        owners = payload.get("owners")
        if not isinstance(session, str) or not session or not isinstance(owners, list):
            raise ValueError("Backend session and active owners are required")
        with self.lock:
            changed = self.session != session
            self.session, self.heartbeat = session, time.monotonic()
            allowed = {(item.get("workflowId"), item.get("blockId")) for item in owners if isinstance(item, dict)}
            for live in list(self.active.values()):
                record = live["record"]
                if changed or (record["workflowId"], record["blockId"]) not in allowed:
                    self.stop(record["id"], "interrupted" if changed else "stopped")
        return {"ok": True}

    def close(self):
        for job_id in list(self.active):
            self.stop(job_id)
        for thread in self.threads:
            thread.join(timeout=8)
        self.db.close()


class Handler(BaseHTTPRequestHandler):
    runner = None
    token = ""

    def log_message(self, *_args):
        pass

    def respond(self, status, payload):
        body = encoded(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def dispatch(self):
        if not self.token or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.token):
            return self.respond(401, {"error": "Unauthorized"})
        try:
            if self.command == "GET":
                if self.path == "/scripts":
                    return self.respond(200, self.runner.scripts())
                if urlsplit(self.path).path == "/jobs":
                    query = parse_qs(urlsplit(self.path).query)
                    filters = {key: query[key][0] for key in ("workflowId", "runId", "blockId") if key in query}
                    if any(not value or len(value) > 100 for value in filters.values()):
                        raise ValueError("Invalid job filter")
                    jobs = [job for job in self.runner.jobs() if all(job.get(key) == value for key, value in filters.items())]
                    return self.respond(200, {"items": [{**job, "logs": job["logs"][-1024:]} for job in jobs[:100]]})
                if re.fullmatch(r"/jobs/[a-f0-9-]{36}", self.path):
                    return self.respond(200, {"job": self.runner.get(self.path.split("/")[2])})
            else:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    raise ValueError("Request must contain 1 to 32768 bytes")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Request must be an object")
                if self.path == "/run":
                    return self.respond(200, self.runner.run(payload))
                if self.path == "/reconcile":
                    return self.respond(200, self.runner.reconcile(payload))
                if self.path == "/stop-owner":
                    with self.runner.lock:
                        for live in list(self.runner.active.values()):
                            job = live["record"]
                            if job["workflowId"] == payload.get("workflowId") and (payload.get("blockId") is None or job["blockId"] == payload["blockId"]):
                                self.runner.stop(job["id"])
                    return self.respond(200, {"ok": True})
                if re.fullmatch(r"/jobs/[a-f0-9-]{36}/stop", self.path):
                    return self.respond(200, {"job": self.runner.stop(self.path.split("/")[2])})
            return self.respond(404, {"error": "Not found"})
        except (ValueError, OSError):
            return self.respond(400, {"error": "Script request failed; check configuration, script files and runner availability"})
        except Exception:
            return self.respond(503, {"error": "Script runner is unavailable"})

    do_GET = dispatch
    do_POST = dispatch


def main():
    if os.geteuid() == 0:
        raise SystemExit("The script runner must not run as root")
    Handler.token = os.environ.get("SCRIPT_HELPER_TOKEN", "")
    if not Handler.token:
        raise SystemExit("SCRIPT_HELPER_TOKEN is required")
    Handler.runner = Runner(os.environ.get("SCRIPT_ROOT", "/opt/edge-studio-scripts"),
                           os.environ.get("SCRIPT_STATE_DIR", "/var/lib/edge-studio-scripts"),
                           os.environ.get("DISPLAY_HELPER_URL", ""), os.environ.get("DISPLAY_HELPER_TOKEN", ""))
    server = ThreadingHTTPServer((os.environ.get("SCRIPT_HELPER_HOST", "127.0.0.1"), int(os.environ.get("SCRIPT_HELPER_PORT", "38184"))), Handler)
    def stop(*_args):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever()
    finally:
        Handler.runner.close()
        server.server_close()


if __name__ == "__main__":
    main()
