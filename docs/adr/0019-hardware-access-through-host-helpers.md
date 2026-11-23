# 0019: Hardware Access Through Host Helpers and a Root Host Agent

**Status:** Accepted
**Date:** 2026-08-12

## Context

Camera, I2C sensor, GPIO, and local MQTT support need host access: device nodes, systemd units,
`.env`, Compose profiles and overrides, and sometimes OS packages. The backend and frontend run in
Docker as non-root and must stay that way.

Camera support was first switched on only at install time (`ENABLE_CAMERA=true`), so changing it
later meant rerunning `install.sh`. BME280/BME680 sensors are polled over I2C, not edge-triggered
pins, so they don't fit the GPIO input model.

Real Pi testing showed that leaving all OS prerequisites manual was safe but needlessly forced SSH
for I2C, whose setup steps on Raspberry Pi OS are fixed and already shown in the UI.

## Decision

- **Trusted installed code uses a distinct non-root runner.** The approved custom-code extension runs fixed-ID Python entry points under `edge-studio-code`, outside the backend and root agent. Source stays in `/opt/edge-studio-scripts`; private managed jobs/data stay in `/var/lib/edge-studio-scripts`. Setup is a fixed installer/terminal action, not a remote generic code/package endpoint. Systemd service restrictions reduce accidental access but do not sandbox mutually untrusted Python or isolate same-account jobs. A minimal child environment avoids accidental credential inheritance; it is not an isolation guarantee. Per-script dependencies are installed deliberately, never at workflow execution.
- **One code block, two lifetimes.** Bounded jobs gate workflow completion and fail it on nonzero exit/timeout. Background jobs return once spawned, with independent status/logs/results and explicit keep/restart/update repeat policy. Pause/archive/delete/config edits stop ownership-scoped jobs. Backend sessions/reconciliation and orphan expiry stop abandoned jobs; restarts never resume them. A job result is not an exactly-once external-effect guarantee. Four concurrent jobs and bounded inputs/results/logs keep cooperative scripts manageable; detached/uncooperative Python remains trusted operator behavior.
- **LCD ownership remains in the display helper.** A custom-code manifest may declare `display.frames`; the workflow then offers Device access filtered to compatible configured PIM576 displays. The runner brokers fixed-size RGB frames through an expiring exclusive lease and paces them to 20/second. Legacy `display` declarations normalize to `display.frames`; saved workflows retain their generic `targetId`. Scripts without the capability receive no device session, even if a stale target remains saved. This is broker selection, not a Python sandbox permission. Renewal every five seconds with a 15-second lease tolerates brief scheduling delays while releasing a crashed runner's display promptly. No second SPI handle, arbitrary image path, generic device API or code execution is introduced into the display helper. Ten-second backend reconciliation with 45-second orphan expiry tolerates several missed requests before interrupting scripts; these are operational bounds, not measured hardware limits.
- **Restore display state at logical output boundaries.** Before a text write or the first successful frame of a newly acquired display session, restore SPI mode 0/MSB-first/16 MHz, initialize the controller and enable the backlight, retaining the existing SPI/GPIO handle. The first handle construction already performs initialization. The pinned ST7789 1.0.1 driver's `begin()` is a deprecated no-op; its `_init()` performs the required software reset/controller sequence. Those private driver calls were checked against the installed 1.0.1 code with mocked hardware. A Pi accepted text/RGB writes while visibly blank, and the contributor reported workflow output working after restarting the helper; the exact cause of stale state remains unknown. Valid lease renewals and later frames preserve prepared state, avoiding periodic resets during an animation. Invalid/busy requests do not reset hardware, and a failed initialization/write does not mark the session prepared. Initialization adds the driver's approximately 250 ms reset/display-on delay to each logical operation, not every animation frame. A panel reset during a continuous animation still needs a new job/session; software cannot detect visible pixels through this write-only interface.
- **Host-side helpers for device I/O.** Camera capture and BME/BH1750 sensor reads run in small,
  opt-in, token-protected host Python helpers (`camera-helper/`, `sensor-helper/`) reachable from
  the Docker subnet, exposing only allowlisted reads for supported devices. The backend container
  gets no `/dev/i2c-*` or camera device and no native I2C dependency. GPIO input is the exception:
  explicit `/dev/gpiochip0` access with `gpiomon`, input-only.
- **BH1750 measurements use raw I2C in the existing sensor helper.** Enable/repair installs `smbus2` in the existing managed virtualenv. The helper powers on/resets the chip, sets standard MTreg 69 (`0x42`, `0x65`), requests one-shot high resolution (`0x20`), waits the documented worst-case 180 ms, and reads exactly two bytes without sending a register byte. It converts the big-endian count to lux by dividing by 1.2. These values come from the [ROHM BH1750FVI datasheet linked by Adafruit](https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf); no physical timing claim is made. A helper-local lock serializes BH1750 requests so overlapping manual/workflow reads cannot restart each other's conversions. Only bus/address are operator settings; fixed mode avoids a range/calibration UI for the initial lux-reading scope. The helper reports model support only when `smbus2` imports, and callers warn when an older helper lacks it.
- **SPI display output stays in a dedicated opt-in helper.** PIM576 title/text rendering uses Pillow and Pimoroni's `st7789==1.0.1` driver in a retained virtualenv, with one fixed SPI0 CE0/DC GPIO25/BL GPIO24 layout and only rotation editable. This keeps SPI/GPIO dependencies outside the non-root backend, avoids arbitrary pin/command or file/URL rendering endpoints, and reuses the workflow's existing output budget and variable interpolation. The helper binds to the configured Docker gateway and requires its own token. Fixed white-on-black text, 16 MHz SPI, zero offsets and a 20-pixel font keep the initial scope small; panel geometry and Debian GPIO compatibility still need physical evidence. Initial adoption requires installer refresh because an older agent's fixed artifact allowlist cannot extract a newly added helper file; subsequent artifacts include it. No signature/allowlist boundary is weakened to bypass that transition.
- **A root host agent for enabling hardware after install.** `install.sh` always installs
  `edge-studio-host-agent` (systemd, Python stdlib), with `HOST_AGENT_URL`/`HOST_AGENT_TOKEN` passed
  only to the backend. The backend reaches it through admin-gated `/api/host-capabilities` routes.
- **Narrow API.** Each capability (`camera`, `sensors`, `gpio`, `mqtt`) has its own fixed action
  set, including `displays` for SPI text output. The agent rejects unknown fields and never accepts command strings, package names, paths,
  or service names. It manages only Edge Studio-owned helper units, `.env` keys, the generated GPIO
  override, and Compose restarts; it refuses to replace a user-managed override. Writes are atomic
  and retry-safe.
- **Installer and agent share one implementation.** The agent owns enable/disable after install;
  the installer's `ENABLE_*` shortcuts call the same code in CLI install mode.
- **OS prerequisites change only through explicit setup actions.** The separate
  I2C prerequisite action (`POST /api/host-capabilities/sensors/setup-prerequisites`) runs the
  hardcoded Raspberry Pi OS steps `apt-get update`, `apt-get install -y python3-smbus i2c-tools`,
  `raspi-config nonint do_i2c 0`. It returns step labels, success, the resulting capability, and
  whether a reboot is needed, never raw output, and records an audit event. Manual steps stay
  available.
- **SPI prerequisite setup is also explicit.** Hardware support offers Automatic setup separately from display enablement. The root action checks for `apt-get` and `raspi-config`, installs fixed Python environment/build prerequisites and calls `raspi-config nonint do_spi 0`. It reports step success and whether `/dev/spidev0.0` is still absent; no helper enablement or reboot is implied. This follows the I2C boundary while leaving manual guidance for Debian hosts without the required tools; it does not introduce arbitrary boot-file editing or package-repository management.
- **Host-backed devices follow capability state.** Unavailable templates are hidden, configured
  devices show `Disabled`/`Needs attention`, and workflow validation reports the missing support.
- The agent's own code is updated through signed host-runtime artifacts delivered by
  `update-agent` (see the update-agent rule), not by rerunning `install.sh`.
- **Uninstallation stays in the host terminal.** Settings offers a copyable command for a fixed-purpose root uninstaller, without adding a remote deletion endpoint to the agent. The operator reviews the removal plan and confirms in `/dev/tty`; the application cannot reliably report completion after removing its own containers. Data is retained in place by default, including `.env` and `APP_SECRET`, to preserve reinstallability. Deletion is limited to validated internal data paths; external or ambiguous ownership stays a manual operation. Configuration stays whenever configured data remains. Legacy firewall rules lack ownership tags, so matching rules from verified units require a separate operator attestation before removal.

## Alternatives considered

- **Animation-specific workflow blocks.** Constrain custom behavior to application-authored animations. Installed Python and a frame interface let operators supply animation logic without new block types.
- **Inline Python or shell in the backend/root agent.** Couples trusted custom-code execution to application/root credentials and broadens an existing narrow boundary. A separate opt-in non-root service makes the execution trust explicit.
- **Background start with no durable job record or repeat policy.** Hides later failures and spawns unbounded duplicates under schedules. Jobs keep observable status and one active execution per workflow/block.
- **Recreate the display object for each recovery, or reset on every frame/lease renewal.** Reopening the GPIO lines can conflict with the existing owner; repeated controller resets interrupt animation and add avoidable delays. Reuse the handle and initialize only at a logical operation's first write. `begin()` cannot provide this recovery on the pinned driver because it does nothing.
- **Mount `/dev/i2c-1` into the backend with a native Node I2C library.** Simpler at first, but
  fragile native builds on ARM/Docker and hardware access inside the app container.
- **Use SMBus register-block reads for BH1750.** They send an extra command/register byte; BH1750 expects a raw two-byte I2C read after conversion. `smbus2.i2c_rdwr` provides that transaction without a new hardware service.
- **Use the Adafruit CircuitPython/Blinka stack for BH1750.** Valid upstream option, but introduces a broader board abstraction and dependency chain when the existing helper already owns bus/address selection and needs only a fixed command/read sequence.
- **A privileged or root backend container.** Defeats the non-root boundary.
- **A generic command runner or service-management endpoint.** Turns the root agent into a shell.
- **Fold host management into the backend or `update-agent`.** The backend can't have host
  privilege; `update-agent` is scoped to signed container updates.
- **Keep prerequisites manual only.** Forces SSH for a fixed, common setup path.
- **Run I2C setup inside normal sensor enablement.** Changing OS packages and interfaces is a
  different risk level from enabling a helper and should stay an explicit admin action.
- **Reboot automatically after setup.** Disrupts the session; stays an operator action.
- **Uninstall through an agent endpoint.** Adds a remote destructive host action and needs an independent job runner that survives removal; terminal instructions cover the current scope.
- **Delete the entire installation directory or globally prune Docker images.** Can remove unknown files or resources belonging to other applications.

## Consequences

- Hardware support can be enabled and disabled from Devices → Hardware support without a terminal.
- The agent holds root and has one OS-package action; its safety depends on keeping every action
  fixed-purpose. New hardware adds a capability, never a generic path.
- Non-Raspberry Pi OS or non-`apt` systems still use manual setup.
- Actions are synchronous behind a blocking modal with polling; long actions could outgrow request
  timeouts.
- Uninstalling retained-data installations leaves configuration and operational metadata on disk; external data and unverified legacy firewall rules require manual review. There is no automatic secure erase.

## History

- 2026-11-23: Generalized the custom-code display field to capability-filtered Device access while retaining only the narrow PIM576 frame broker and legacy manifest compatibility.
- 2026-11-23: Restore cached SPI/controller/backlight state before text output and new-session first frames; preserve prepared state across animation frames and lease renewals.
- 2026-11-21: Added trusted installed-script execution, bounded/background lifecycle, fixed installer-only runner setup and exclusive LCD frame sessions.
- 2026-11-20: Added explicit SPI prerequisite setup in Hardware support, with manual fallback and operator-managed reboot.
- 2026-11-20: Added a narrow SPI text-display helper, fixed PIM576 wiring, managed driver dependencies and explicit first-adoption installer refresh.
- 2026-11-19: BH1750 raw I2C lux reads, fixed conversion timing, managed smbus2 dependency and serialized measurements within the existing sensor capability.
- 2026-11-03: Terminal uninstaller and Settings instructions; retained-data and host-resource ownership boundaries.
- 2026-09-10: Root host agent with per-capability actions, and the explicit I2C prerequisite action
  (was "I2C Prerequisite Setup Action").
