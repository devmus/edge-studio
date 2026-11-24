import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, it } from "vitest";
import { setupTestDatabase } from "../../helpers/testDatabase.js";

let db: import("better-sqlite3").Database;
let teardown: () => void;
let app: express.Express;

beforeAll(async () => {
  ({ db, teardown } = await setupTestDatabase());
  const { settingsRouter } = await import("../../../src/features/settings/settings.routes.js");
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.get("x-test-role");
    if (!role) return void res.sendStatus(401);
    req.user = { id: "admin", displayName: "Admin", role: role as "admin", lastLogin: null, credentialType: "password" };
    next();
  });
  app.use("/api/settings", settingsRouter);
});
beforeEach(() => db.exec("DELETE FROM settings; DELETE FROM audit_events;"));
afterAll(() => teardown());

it("requires authentication and admin access", async () => {
  assert.equal((await request(app).get("/api/settings/developer-diagnostics")).status, 401);
  assert.equal((await request(app).get("/api/settings/developer-diagnostics").set("x-test-role", "viewer")).status, 403);
});

it("enables and disables developer diagnostics through the admin API", async () => {
  const initial = await request(app).get("/api/settings/developer-diagnostics").set("x-test-role", "admin");
  assert.deepEqual(initial.body.settings, { enabled: false, enabledUntil: null });
  assert.deepEqual(initial.body.durationsMinutes, [15, 60, 1440]);

  const enabled = await request(app).post("/api/settings/developer-diagnostics").set("x-test-role", "admin").send({ enabled: true, durationMinutes: 15 });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.settings.enabled, true);
  assert.ok(enabled.body.settings.enabledUntil);

  const disabled = await request(app).post("/api/settings/developer-diagnostics").set("x-test-role", "admin").send({ enabled: false });
  assert.deepEqual(disabled.body.settings, { enabled: false, enabledUntil: null });
  assert.equal(db.prepare("SELECT COUNT(*) FROM audit_events WHERE action = 'settings.developer_diagnostics_changed'").pluck().get(), 2);
});

it("returns field errors for unsupported durations", async () => {
  const response = await request(app).post("/api/settings/developer-diagnostics").set("x-test-role", "admin").send({ enabled: true, durationMinutes: 30 });
  assert.equal(response.status, 400);
  assert.ok(response.body.errorDetails.context.fieldErrors.durationMinutes);
});
