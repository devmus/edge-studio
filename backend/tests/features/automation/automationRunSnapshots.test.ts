import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { blockConfigSnapshot, namedRunSnapshot, runSnapshot } from "../../../src/features/automation/automationRunSnapshots.js";

describe("workflow diagnostic snapshots", () => {
  it("records explicit unlimited custom-code settings and redacts parsed JSON without mutating execution inputs", () => {
    const secret = ["test", "credential"].join("-");
    const config = { scriptId: "animate-lux", executionMode: "background", timeoutSeconds: null, onRunning: "update", inputsJsonText: JSON.stringify({ lux: "{{message}}", durationSeconds: null, password: secret }), ignored: secret };
    const snapshot = blockConfigSnapshot("run_custom_code", config);
    assert.equal(snapshot.timeoutSeconds, null);
    assert.equal(snapshot.onRunning, "update");
    assert.deepEqual(JSON.parse(String(snapshot.inputsJsonText)), { lux: "{{message}}", durationSeconds: null, password: "[redacted]" });
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.equal(JSON.parse(config.inputsJsonText).password, secret);
    assert.equal(blockConfigSnapshot("run_custom_code", {}).timeoutSeconds, 30);
  });

  it("bounds oversized payloads and fails closed on invalid JSON", () => {
    assert.deepEqual(runSnapshot({ huge: "a".repeat(20000) }), { omitted: "Diagnostic value exceeds size limit", sizeBytes: 20011 });
    assert.equal(blockConfigSnapshot("set_variable", { valueJsonText: "{bad" }).valueJsonText, "[invalid JSON omitted]");
    assert.equal(typeof blockConfigSnapshot("show_preview", { title: "a".repeat(5000) }).title, "string");
  });

  it("redacts named scalar secrets and distinguishes missing from null", () => {
    assert.equal(namedRunSnapshot("password", "hidden"), "[redacted]");
    assert.equal(namedRunSnapshot("lux", null), null);
    assert.deepEqual(namedRunSnapshot("lux", undefined), { missing: true });
    assert.equal(blockConfigSnapshot("set_variable", { variableName: "apiKey", valueJsonText: '"hidden"' }).valueJsonText, '"[redacted]"');
    assert.equal(blockConfigSnapshot("if_payload_field_equals", { source: "variable", variableName: "password", value: "hidden" }).value, "[redacted]");
  });
});
