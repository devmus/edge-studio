# Developer Diagnostics And Smart Workflow History Plan

**Status:** In progress
**Created:** 2026-11-24
**Goal:** Keep normal workflow history focused on meaningful activity while allowing an administrator to temporarily capture full diagnostics at runtime.

## Progress

- [x] Add an audited, expiring runtime Developer diagnostics setting without changing installer `DEV_MODE` semantics.
- [x] Compact repeated safe scheduled no-op runs into fixed-window representative summaries while retaining write-first failure evidence.
- [x] Update run APIs, retention, archives and Watch/Diagnostics UI for summary metadata and full-capture state.
- [x] Add backend/frontend regression coverage for settings, compaction safety, history presentation and compatibility.
- [x] Docs: update operator, workflow, security, ADR, session and task documentation.
- [ ] Verification: run focused tests, full application checks, builds, Compose validation and browser/Pi checks where available.

Local verification is complete: backend (1,595), frontend (1,876) and update-agent (194) coverage suites pass, as do all three builds, lint/docs/mirror checks, Compose configuration and full/production application audits. The full root check retains the documented Windows shell/CRLF fixture result (75 passed, 41 failed, 3 skipped). Browser/Pi behavior remains the open verification item.

## Context

High-frequency schedule workflows currently persist a parent run and several block rows for every poll, even when a standalone condition rejects an unchanged value before any action runs. At a two-second interval this creates 43,200 run records per day and makes meaningful updates difficult to find. Data-source reads are product history with their own retention policy; workflow runs are diagnostic evidence and should describe decisions and effects rather than act as the sensor time series.

The existing installer `DEV_MODE` controls source builds, signed-manifest verification, update-agent participation and build identity. It remains deployment configuration. Runtime Developer diagnostics is a separate SQLite app setting: administrators can temporarily capture every workflow run and enable existing safe backend diagnostics without changing installation trust or requiring a restart.

Execution remains write-first. Runs and block rows are created before work so crashes and failures leave evidence and current run IDs remain valid for inbox items, script jobs and budgets. Only a conclusively successful, scheduled, unmatched-condition run with an explicitly harmless executed block set may be compacted afterward. Deferred in-memory logging was rejected because it weakens crash evidence and complicates foreign-key and helper ownership.

## Backend Changes

1. Add a typed developer-diagnostics settings service and admin API under `backend/src/features/settings/`. Persist `enabledUntil`, validate bounded durations, fail closed on malformed state and atomically audit changes. Reuse the policy from workflow logging and the backend side of existing host-capability diagnostics; do not expose helper credentials or disable redaction.
2. Extend `automation_runs` with outcome, occurrence count, latest occurrence and coalescing identity fields. Legacy rows default to one completed occurrence. Keep status semantics unchanged.
3. Classify only successful scheduled runs stopped by an unmatched standalone condition and containing the allowlisted polling/logic blocks as no-op candidates. Manual/event runs, failures, any earlier matched condition, and any effectful/unknown block remain full records.
4. Retain the first no-op as a representative full heartbeat. During a fixed one-hour window, atomically increment the equivalent summary and delete the newly completed parent/block rows. A changed enabled workflow shape creates a new summary. Full Developer diagnostics bypasses compaction.
5. Order run lists and retention by latest represented activity. Extend archive output/import compatibility so summaries retain counts/timestamps without changing product-data or evidence lifecycle.

## Frontend Changes

1. Add a lazy **Developer diagnostics** Settings section with an explicit off state, bounded capture durations, expiry status, storage/privacy warning and immediate disable action.
2. Extend automation run types and tables with outcome, represented-check count and first/latest occurrence. Label representative block details clearly.
3. Present normal history as meaningful activity: compacted rows show `N scheduled checks · no action`; full matched/effectful/manual/failure runs remain individually inspectable. Updating a summary's count must not repeatedly replay it as a new run in Watch.

## Docs

- Amend ADR 0022 with smart workflow diagnostic retention and ADR 0041 with the runtime/deployment-mode distinction.
- Update `README.md`, `SECURITY.md`, `docs/guides/contributing-workflows.md`, `docs/SESSION.md` and `docs/TASKS.md`.
- Keep mirrored automation rules synchronized if the contributor rule changes.

## Verification

- Backend settings tests: defaults, enable/disable, duration bounds, expiry, malformed-state fail-closed behavior, audit rollback and admin route authorization.
- Automation tests: first heartbeat, repeated compaction, fixed-window rollover, configuration split, diagnostics bypass, manual/failure/matched/effectful preservation, baseline/read/inbox/job/budget relationships and migration defaults.
- Retention/archive tests: latest-activity ordering, atomic parent/block cleanup and compatible summary export/import.
- Frontend tests: lazy Settings panel, enable/disable/expiry states, summary table/inspection, and Watch follow/replay behavior.
- Run `npm run lint`, `npm run check`, all application builds, `docker compose config`, relevant audits and `git diff --check`; report the known Windows shell-fixture and Docker-daemon limitations accurately.
- On the Pi, confirm normal polling coalesces while lux changes remain full activity, then enable Developer diagnostics and confirm every poll is retained until expiry/disable.
