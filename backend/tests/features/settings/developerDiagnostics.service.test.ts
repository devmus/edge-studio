import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { setupTestDatabase } from "../../helpers/testDatabase.js";

let db: import("better-sqlite3").Database;
let teardown: () => void;
let service: typeof import("../../../src/features/settings/developerDiagnostics.service.js");

beforeAll(async () => {
  ({ db, teardown } = await setupTestDatabase());
  service = await import("../../../src/features/settings/developerDiagnostics.service.js");
});
beforeEach(() => {
  db.prepare("DELETE FROM settings WHERE key = 'developer_diagnostics_settings'").run();
  db.prepare("DELETE FROM audit_events").run();
});
afterAll(() => teardown());

describe("developer diagnostics settings", () => {
  it("defaults off and enables only for an allowed bounded duration", () => {
    const now = Date.parse("2026-11-24T10:00:00.000Z");
    assert.deepEqual(service.getDeveloperDiagnosticsSettings(now), { enabled: false, enabledUntil: null });
    assert.deepEqual(service.saveDeveloperDiagnosticsSettings({ enabled: true, durationMinutes: 60 }, undefined, now), {
      enabled: true,
      enabledUntil: "2026-11-24T11:00:00.000Z",
    });
    assert.equal(service.isDeveloperDiagnosticsEnabled(now + 3599999), true);
    assert.equal(service.isDeveloperDiagnosticsEnabled(now + 3600000), false);
  });

  it("disables immediately and audits previous and new policy", () => {
    const now = Date.parse("2026-11-24T10:00:00.000Z");
    service.saveDeveloperDiagnosticsSettings({ enabled: true, durationMinutes: 15 }, undefined, now);
    assert.deepEqual(service.saveDeveloperDiagnosticsSettings({ enabled: false }, undefined, now + 1), { enabled: false, enabledUntil: null });
    const audit = db.prepare("SELECT detail FROM audit_events WHERE action = 'settings.developer_diagnostics_changed' ORDER BY rowid DESC LIMIT 1").get() as { detail: string };
    assert.deepEqual(JSON.parse(audit.detail).settings, { enabled: false, enabledUntil: null });
  });

  it("rejects malformed requests and unsupported durations", () => {
    for (const input of [null, {}, { enabled: "true" }, { enabled: true }, { enabled: true, durationMinutes: 30 }]) {
      assert.throws(() => service.saveDeveloperDiagnosticsSettings(input), service.DeveloperDiagnosticsValidationError);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events").pluck().get(), 0);
  });

  it("fails closed for malformed persisted values", () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run("developer_diagnostics_settings", "not-json");
    assert.deepEqual(service.getDeveloperDiagnosticsSettings(), { enabled: false, enabledUntil: null });
    assert.equal(service.isDeveloperDiagnosticsEnabled(), false);
  });

  it("rolls back the setting when its audit write fails", () => {
    db.exec("CREATE TEMP TRIGGER reject_diagnostics_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    try {
      assert.throws(() => service.saveDeveloperDiagnosticsSettings({ enabled: true, durationMinutes: 15 }), /audit unavailable/);
      assert.deepEqual(service.getDeveloperDiagnosticsSettings(), { enabled: false, enabledUntil: null });
    } finally {
      db.exec("DROP TRIGGER reject_diagnostics_audit");
    }
  });
});
