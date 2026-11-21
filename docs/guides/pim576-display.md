# Pimoroni PIM576 SPI LCD

Display workflow text on the **1.54-inch SPI Colour Square LCD (240×240), Pimoroni PIM576**. This is an output target, not a readable sensor. Control device supports a title and wrapped text, white on black, using a fixed font. Custom images/graphs/animation can be rendered by [installed Python scripts](./custom-code.md) through exclusive frame sessions; other display models remain unsupported.

Product: [Pimoroni PIM576](https://shop.pimoroni.com/en-eu/products/1-54-spi-colour-square-lcd-240x240-breakout?variant=39351811702867). The implementation uses [Pimoroni's ST7789 driver](https://github.com/pimoroni/st7789-python), version 1.0.1. The supplied board photo labels power, CS, SCK, MOSI, DC, BL and GND. The shop page was rate-limited during development; physical panel geometry, orientation and colour behaviour must be checked on the actual board before support is marked verified.

## Requirements

- Target test platform: Raspberry Pi 4 Model B, Debian 13 (trixie), aarch64. Physical PIM576 verification on this setup is **pending**.
- Direct Pi SPI connection using the fixed wiring below: one display on SPI0 CE0, DC GPIO25, backlight GPIO24. The application rejects a second configured display and collisions with configured GPIO devices on these pins. Other processes or HATs can still claim the pins; stop competing drivers before testing.
- Host devices `/dev/spidev0.0` and `/dev/gpiochip0`. Start in **Devices → Hardware support → SPI displays**. If prerequisites are missing, choose **Automatic setup** to install Python prerequisites and enable host SPI using the fixed `raspi-config nonint do_spi 0` action. Setup reports whether a reboot is required; it never reboots or enables the display helper automatically. After any reboot, refresh Hardware support and select Enable.
- Automatic setup requires the host's `apt-get` and `raspi-config`; it checks both before making changes. Use the module's **Manual setup** option on other systems. On Debian without raspi-config, enable `dtparam=spi=on` in the host's active Pi boot configuration, then reboot. Use the host OS documentation to locate its boot configuration; do not assume a path on every OS. The app does not add package repositories or edit arbitrary boot files.
- Python 3 with virtualenv/build support. Hardware support shows copyable commands for `python3-venv`, `python3-dev` and `build-essential` if needed. The helper runs as the installer-selected user with the `spi` and `gpio` groups where present; the devices must be accessible to that user.
- **Devices → Hardware support → SPI displays → Enable**. Enable/Repair creates `.venv-display-helper` and installs `st7789==1.0.1` and `Pillow>=10.1,<13`. First setup may take several minutes and needs package-index connectivity. Dependencies retain their own licenses; no upstream driver code is vendored.

SPI display support starts disabled. The backend remains non-root with no new device mount. It sends authenticated text requests to the narrow host display helper, bound to the configured Docker gateway on `DISPLAY_HELPER_PORT` (default `38183`). Helper status reports prerequisites and software readiness, not physical screen detection.

## Installation and updates

Use the [fork-to-Pi quickstart](./contributor-quickstart.md#fork-source-build-on-a-disposable-pi) for testing. The contribution fork is `https://github.com/devmus/edge-studio`, branch `feat/pim576-spi-display`. The branch must be committed and pushed before installation; the assistant must supply the actual expected SHA after that authorized push. Do not use the current base SHA as evidence that uncommitted changes were installed.

On the test Pi, after the branch is published:

```bash
cd ~
curl -fsSL https://raw.githubusercontent.com/devmus/edge-studio/feat/pim576-spi-display/install.sh -o edge-studio-install.sh
less edge-studio-install.sh
sudo env APP_REPO_URL=https://github.com/devmus/edge-studio.git APP_BRANCH=feat/pim576-spi-display DEV_MODE=true bash edge-studio-install.sh
sudo git -C /opt/edge-studio rev-parse HEAD
cd /opt/edge-studio
sudo docker compose ps
```

Compare the full installed SHA with the pushed expected SHA, confirm running frontend/backend services, open the printed HTTPS address and verify the PIM576 option. The expected SHA is not fixed in this guide. For later revisions, commit/push again on the development computer, record the new SHA, download/inspect/rerun the same source-mode installer on the Pi, and repeat the checks.

**First installation of this new helper requires an installer refresh.** Older host agents only extract their existing file allowlist during an in-app update and may omit a newly introduced helper file. Rerun the matching source installer for a fork test; official releases must document the equivalent installer refresh when this integration ships. Repair gives an actionable error if helper code is absent. Later host-runtime artifacts include the display helper in their fixed allowlist. Do not use the official in-app updater to install unmerged fork changes.

Installer reruns preserve the display-helper virtualenv, token and configured port; enabled support is reapplied through the same fixed host-agent action. Advanced/headless installs may use `ENABLE_DISPLAYS=true`, after host SPI prerequisites are present. Enable/Repair and Disable are deliberate admin actions, distinct from saving a device or enabling a workflow. Uninstall stops the display helper and removes its managed code/environment using the existing confirmed uninstaller path.

## Wiring

Power off and unplug the Pi before wiring. This table uses **physical Pi header pin numbers**, with BCM GPIO names separately identified.

| PIM576 board label | Pi connection |
| --- | --- |
| `3V–5V` | 3.3V, physical pin **1** |
| `CS` | GPIO8 / CE0, physical pin **24** |
| `SCK` | GPIO11 / SCLK, physical pin **23** |
| `MOSI` | GPIO10, physical pin **19** |
| `DC` | GPIO25, physical pin **22** |
| `BL` | GPIO24, physical pin **18** |
| `GND` | Ground, physical pin **6** |

No MISO or reset wire is used. The driver performs software reset. Keep wires short; the fixed SPI clock is 16 MHz. Use only this documented board/wiring initially; matching resolution alone does not establish support for other ST7789 panels.

## Add, test and edit the screen

1. Open **SPI displays** under Hardware support. If Action required is shown, choose **Automatic setup** (or Manual setup on an unsupported host). Reboot only if requested, refresh status, then select **Enable**. Host prerequisite setup, helper enablement and device creation are separate operations.
2. In **Devices → New device**, select **PIM576 SPI LCD**. The option is hidden until display support is enabled.
3. Give it a name, select rotation `0`, `90`, `180` or `270` degrees, review and save. Saving the device does not send an output.
4. From the device menu select **Test display**. It deliberately sends `Edge Studio` / `Display connected` to the physical panel.
5. Check all four corners, text orientation, background and characters. Edit the same saved device to change rotation; its ID and workflow references remain intact. Retry the test after editing.

The device is output-only: it has no manual read action. A successful helper/SPI response confirms the write was accepted, not that a working panel is attached; this wiring has no readback of the screen's appearance.

## Starter workflow: display a custom variable

The device guide creates a **disabled** starter workflow with no other sensors:

1. **Manual run**.
2. **Set variable**: name `message`, source **Custom JSON**, value `"Hello from Edge Studio"` (including the JSON quotation marks).
3. **Control device**: select the LCD; **Display JSON**:

```json
{
  "title": "Edge Studio",
  "text": "{{message}}"
}
```

Review the workflow and run manually. Change the custom variable, save and run again; confirm the screen changes and the output result appears in run/block history. The guide's existing action handling avoids duplicate starter creation. Use a Schedule start only when deliberate repeating updates are wanted; there is no background refresh loop or new block type.

`text` must be a nonempty string of up to 512 characters. `title` is optional, a single line of up to 32 characters. These validation limits do not promise the content fits the panel. Text wraps within 216 pixels; an over-wide title or too many wrapped lines is rejected before a write, preserving the previous frame. The fixed Pillow font determines supported glyphs. Use short plain text for the first test. A variable that resolves to a number/object instead of a string is rejected; set a string variable or build a string around the value.

## Update only after a lux change

With a configured BH1750 sensor and PIM576 screen, build this disabled workflow and test it manually before enabling its schedule:

1. **Schedule** → **Every 1 second**. This is approximate backend polling, not a hardware interrupt; slow runs do not overlap themselves.
2. **Fetch data source** → your BH1750.
3. **Set variable** → name `lux`, source **Latest data field**, field path `lux`.
4. **If field matches** → source **Variable**, name `lux`, operator **changed by at least**, **Minimum change** `1`.
5. **Control device** → your PIM576, Display JSON `{"title":"Light level","text":"Lux: {{lux}}"}`. Keep the prefix: an exact `"{{lux}}"` resolves to a number and is rejected by the string-only display boundary.

The first finite numeric reading passes. Later readings pass when their absolute difference from the last successful workflow baseline reaches the positive numeric threshold, up or down. For example, after displaying 10 lux, 10.4 and 10.8 are filtered out; 11 passes. BH1750 readings currently have approximately 0.83-lux resolution; start with a 1-lux threshold rather than 0.1.

Each condition stores its baseline in SQLite, separately from run history. It survives restarts and pause/re-enable. It advances only when the entire workflow succeeds without a later condition stopping it; output errors keep the old baseline for a later attempt. Editing the condition's source, field/variable, operator or threshold resets it. Unrelated saves preserve it, and a duplicated condition/workflow starts fresh. This operator is available only on the standalone condition, not directly on an attached stamp.

Workflows whose enabled privileged actions are all SPI display text outputs have a fixed budget of **5,000 runs per rolling hour**. Reads, variables and logic do not disqualify them. Adding a payment, camera, stamp or another kind of output keeps the existing **1,000/hour** limit. The same persisted ledger is retained across edits; filtered runs that stop before any privileged action consume no slot, while a failed output consumes one.

Filtering avoids display writes, not sensor reads or run records. One-second polling can create **86,400 reads and runs per day**. Review **Settings → Storage & history** retention; automatic cleanup remains off until explicitly enabled. Physical timing, repeated updates and failure/recovery for this workflow still require Pi verification.

## Failure and privacy behaviour

- Disabled/missing support, malformed JSON, invalid rotation, missing text and GPIO ownership conflicts produce actionable validation or runtime errors.
- The helper serializes hardware writes and reuses its GPIO/SPI handle. It does not run arbitrary commands, retrieve URLs, read image/font paths from requests, or render during configuration preview.
- Workflow runs record display text/results and structured failures through the existing output block path. The triggering sensor's health is not overwritten by a display failure. Existing workflow output budgets still apply.
- Text is visible to people near the screen and retained in workflow history; do not display secrets. This integration does not transmit content to a cloud service.
- Disable stops further helper updates and attempts to turn the backlight off on orderly shutdown. The LCD may retain its previous frame; disconnect power if the image must be removed. Host GPIO release/power-loss behaviour requires physical verification.

## Verification status

**Physical verification is not yet performed.** Automated mocks do not establish wiring, correct geometry/offset, colour inversion, successful GPIO access on Debian, retained state after an actual installer rerun, or visible output. Local rendering tests use real Pillow with a mocked hardware driver.

On the authorized test Pi, record the exact PIM576 board, Pi model, OS/architecture, expected/installed commit, local modifications and Compose service status. Verify Test display, the custom-variable workflow without sensors, updating the variable, all rotations, saved editing/reopen, disable/re-enable, repeated Repair and installer refresh retaining token/environment, missing/busy SPI or GPIO and recovery, too-long text, and concurrent output requests. Capture sanitized screen photos and run results for the PR. Software success alone cannot verify the physical display. Contribution rights, publication and PR readiness are confirmed separately with the contributor; upstream merge/release remains a maintainer action.
