# Installed Python scripts in workflows

**Run custom code** runs trusted Python that an operator installs on the Pi. One block offers **Wait for completion** (default) and **Run in background**. This feature is opt-in and Linux/systemd-based. It is not a Python sandbox or an in-app code editor. Automated subprocess tests do not establish physical LCD animation performance.

## Enable the runner

First install the source build containing this feature using the [contributor quickstart](./contributor-quickstart.md#fork-source-build-on-a-disposable-pi). The development branch is `feat/custom-code-workflows` in `https://github.com/devmus/edge-studio.git`; it must be published before attempting installation. Obtain the actual expected pushed SHA, compare it with `sudo git -C /opt/edge-studio rev-parse HEAD`, and check the frontend/backend containers with `sudo docker compose ps`. An uncommitted local implementation cannot be installed from GitHub.

First adoption requires an installer refresh to add the new helper files and backend environment. Use `ENABLE_CUSTOM_CODE=true` with the source-mode installer, or after refreshing the installation run this fixed setup action on the Pi:

```bash
sudo env APP_DIR=/opt/edge-studio python3 /opt/edge-studio/host-agent/edge_studio_host_agent.py capability apply scripts
sudo systemctl status edge-studio-script-helper --no-pager
```

Setup creates the non-login `edge-studio-code` system account, the fixed source/data directories, and a token-protected service on the configured Docker gateway at `SCRIPT_HELPER_PORT` (38184 by default). The backend receives `ENABLE_CUSTOM_CODE`, `SCRIPT_HELPER_URL` and `SCRIPT_HELPER_TOKEN`. No arbitrary command or package endpoint is added to the root host agent. Script setup is currently a deliberate terminal/installer action, not a Hardware support module. The helper uses Python's standard library; installing script dependencies is separate.

The unit uses `NoNewPrivileges`, `PrivateDevices`, `PrivateTmp`, `ProtectSystem=strict` and `ProtectHome`, with writable managed state under `/var/lib/edge-studio-scripts`. These are practical service restrictions, **not isolation between mutually untrusted scripts**. All scripts share one account and network access; capability declarations govern the frame broker, not arbitrary Python behavior. Do not install untrusted code or treat manifests as a permission sandbox. The runner's credentials are omitted from the child environment, but trusted code sharing its account must not be considered isolated from that account's resources.

## Create and store scripts

Keep your code in your own Git repository on your development computer, then copy reviewed releases into:

```text
/opt/edge-studio-scripts/
└── animate-lux/
    ├── script.json
    ├── main.py
    ├── requirements.txt   # optional; never installed automatically
    └── .venv/            # optional per-script environment
```

The fixed entry point is `main.py`. The manifest's ID must match its directory, start with a lowercase letter and contain only lowercase letters, digits and hyphens (maximum 64 characters). The directory, manifest and entry point must not be symlinks. Keep deployed source/environments root-owned and readable/executable by `edge-studio-code`; the service cannot modify `/opt`.

```json
{
  "id": "animate-lux",
  "name": "Animate light level",
  "entrypoint": "main.py",
  "capabilities": ["display"]
}
```

Use `"capabilities": []` for scripts that do not need the LCD broker. `requirements.txt` is an operator convention, not something the runner reads. If `.venv/bin/python` exists, it is used; otherwise the system Python interpreter is used. Install dependencies only after reviewing their code/licensing:

```bash
sudo cp -r /opt/edge-studio/script-helper/examples/animate-lux /opt/edge-studio-scripts/animate-lux
sudo python3 -m venv /opt/edge-studio-scripts/animate-lux/.venv
sudo /opt/edge-studio-scripts/animate-lux/.venv/bin/python -m pip install -r /opt/edge-studio-scripts/animate-lux/requirements.txt
```

This example assumes `python3-venv` is installed. Do not overwrite an existing script directory accidentally: update your own deployment deliberately and stop its active jobs first. Select **Refresh scripts** in the block after adding/changing code or manifests. Invalid manifests appear as discovery errors; missing saved selections remain visible.

Source and managed data remain outside the app checkout. Installer reruns do not replace user scripts. Uninstall stops the service and removes application-owned helper code, while **preserving `/opt/edge-studio-scripts` and `/var/lib/edge-studio-scripts`, even with app-data deletion**. Back them up separately; app run-history export does not include script source, dependencies or state. The retained system account owns managed data for reinstalls.

## Script interface

The runner starts Python with an argument array, never a shell command. Inputs arrive as JSON lines on stdin. Scripts can use the bundled `edge_script` SDK, made available through `PYTHONPATH`:

```python
from edge_script import inputs, log, result

config = inputs()  # waits for first input
log("Calculating")
result({"doubled": config["value"] * 2})
```

- `inputs()` waits for the next available input; `inputs(wait=False)` returns the newest queued input or `None`. Update-mode scripts must read input messages. A full bounded input queue causes the triggering block to fail rather than buffering indefinitely.
- `log(message)` writes a structured log line. Plain stdout/stderr is also captured as logs. Logs must never include secrets.
- `result(value)` publishes a JSON result; the last result is retained. Process exit code determines success, so printing a result then exiting nonzero is a failure.
- `frame(image)` accepts a Pillow 240×240 image and sends RGB pixels through the runner's display broker. A script declaring `display` requires a selected, enabled PIM576 target; it never needs a competing SPI/GPIO handle. Frames are paced to at most 20/second by the broker, not the workflow scheduler. Actual Pi performance may be lower.
- `EDGE_SCRIPT_DATA_DIR` identifies your persistent per-script directory under `/var/lib/edge-studio-scripts/data/<id>`. Write persistent files there; working directory is the installed script directory, which is read-only under the service policy.

The wire protocol is one JSON object per stdout line: `{"type":"log","message":"..."}`, `{"type":"result","value":...}` or `{"type":"frame","rgb":"<base64 RGB bytes>"}`. Inputs/results are limited to 16 KiB, logs to 16 KiB per job and output lines to 240,000 bytes. Exceeding output limits fails/stops the job. Four jobs may run concurrently. Limits bound normal cooperation; trusted Python can still consume CPU, create files or make network requests outside the SDK.

## Configure the workflow

1. Add **Run custom code** from **Action**.
2. Select an installed script and **Execution mode**.
3. Enter **Inputs JSON**. Exact variable placeholders preserve types, e.g. `{"lux":"{{lux}}"}` sends numeric lux when the variable is numeric.
4. Set a **Time limit, seconds** from 1 to 3600. Bounded mode requires it (default 30 seconds); background mode allows a blank limit for continuous operation.
5. If required by the manifest, select the PIM576 **Display target**.

**Wait for completion:** the workflow stays active until the job exits. Failure/timeout fails the block. Its output includes `output.job.result`, which a later Set variable block can read through **Workflow context field**. Normal successful-completion change-baseline behavior applies.

**Run in background:** enable the owning workflow first, including for manual starts. The workflow continues after Python starts. Success means process creation, not completed animation or business work. Later failures appear in the job inspector without rewriting the historical workflow run. A change condition's baseline may therefore advance before a later background error; use bounded mode when downstream success must govern retry. Owner/configuration changes during startup are rechecked and the newly started job is stopped.

Background repeat policies are scoped to the workflow/block, not the script ID globally:

| Policy | Behavior |
| --- | --- |
| Keep running (default) | Reuse the active job and ignore new inputs |
| Restart with new inputs | Stop the old process group, then start the selected script with current inputs |
| Update inputs | Send new JSON inputs to the active job; start it if none is running |

To change scripts while a job is active, stop it or use Restart. Script declarations are rechecked on each trigger. Custom-code blocks use the conservative **1,000 privileged workflow runs/rolling hour** budget, including Keep/Update triggers. They never qualify for the display-text-only 5,000 exception. A background job's internal work/frames are not individual workflow runs and are not rate-limited by that ledger.

## Jobs, stopping and restart

**Edit mode configures scripts only.** To inspect execution, open **Watch**, select a historic run and its Run custom code block. Its Result section shows the associated job's ID, action/status recorded with that run, full logs/result and a preserved snapshot. **Script jobs** in the selected-run/history controls opens the same inspection for every custom-code block in that run, including successful runs.

For active/background jobs, **Current job status** and **Current job logs and result** update while the inspector is open; **Job snapshot recorded with this run** remains the original acknowledgement. Keep/Update runs link to the same job ID even though its originating run differs. Later job failures do not rewrite the historic workflow status. **Stop job** appears here for a confirmed live job; stopping a shared job affects every run that references it.

Old runs without a job snapshot are matched by exact workflow/run/block IDs, never by the block's newest job. Filtering happens before the helper's 100-job list limit. If the retained job has expired, Watch reports that explicitly. If the helper is unavailable, saved snapshots remain readable; live state/Stop are unavailable until it recovers. Authenticated admin APIs expose `/api/custom-code/jobs` (optional `workflowId`, `runId`, `blockId` filters), `/api/custom-code/jobs/:id` (full retained logs), and POST `/api/custom-code/jobs/:id/stop`.

Stopping a job does not disable its workflow: the next trigger can start it again. Pause the workflow first when stopping permanently. Pause/archive/delete stops owned jobs; editing or disabling the script block also stops its current job. A later failed workflow block does not undo a background process that already started. Backend ownership reconciliation runs every ten seconds, and loss of reconciliation interrupts jobs after 45 seconds. A new backend session stops old jobs; a runner restart marks saved active jobs interrupted. Neither restart resumes custom jobs automatically, though the next enabled workflow trigger can start a new one.

Pause/delete requests an immediate stop but still applies when the helper is unavailable, allowing operators to disable new triggers during an outage. Ownership reconciliation retries cleanup; if helper communication remains unavailable, cooperative jobs expire after the 45-second heartbeat limit. The explicit Stop job action reports an error when it cannot contact the helper.

The runner keeps at most 1,000 recent terminal job records (active jobs are protected), separately from app run retention. Logs/results are local runner data and may contain private input/output; the data directory is private to the service account. Stopping terminates the process group; deliberately detached processes from trusted code are outside a process-group guarantee, while stopping the whole systemd service kills its cgroup.

The LCD is exclusively leased to one job; other scripts and normal text writes receive a busy error. Sessions expire after 15 seconds without renewal. Frames/lease renewals extend them. Stop/exit releases the lease; an expired script cannot write over a new owner. The last frame may remain on screen after release; clearing sensitive content is the script/operator's responsibility.

To disable the runner deliberately:

```bash
sudo env APP_DIR=/opt/edge-studio python3 /opt/edge-studio/host-agent/edge_studio_host_agent.py capability disable scripts
```

## Lux animation example

Enable SPI displays separately, install the bundled `animate-lux` example, and test:

**Manual run → Set variable `lux` (Custom JSON `12.5`) → Run custom code** with script Animate light level, Wait for completion, 30-second limit, PIM576 target and inputs:

```json
{"lux":"{{lux}}","durationSeconds":5}
```

In Set variable, **Custom JSON is the value itself**: enter `12.5`, not `{"value":"12.5"}`. The latter stores an object, which the example cannot convert to a numeric lux reading. If you see “unknown variable: lux”, check the exact variable name and that the enabled Set variable block comes before Run custom code. When viewing history, use **Show on canvas** for the run you want; Follow latest run controls whether newer runs replace that selection.

For failures, use **View error details** in the selected block, **View selected run error** above the canvas, or **Error details** in history. These open the existing workflow error modal, whose **Script jobs** section includes run-linked logs/results and current job status. New failed custom-code runs preserve job metadata and the native error; older runs use retained-job lookup when possible. A previous block's output is never substituted for the script job. Later background failures have their own **View job error details** action in Watch.

For a continuous animation, select Run in background, blank time limit, Update inputs and `{"lux":"{{lux}}","durationSeconds":null}`. The script reads new lux values without restarting the animation. Use a suitable sensor trigger/schedule; one-second triggers reaching custom code exhaust 1,000/hour, so use at least a five-second schedule or change filtering. Check the job and stop/pause deliberately.

Physical verification remains required: visible animation/rotation, text-busy handling, repeated updates, stop/release, runner/backend restart, pause/delete, resource use on the actual Pi and dependency/service repair. Record model/OS, expected/installed SHA, container/service health and sanitized evidence. No actual Pi deployment or display action is implied by the examples.
