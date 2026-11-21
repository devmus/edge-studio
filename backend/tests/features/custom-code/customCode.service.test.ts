import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDatabase } from "../../helpers/testDatabase.js";

let teardown: () => void;
let service: typeof import("../../../src/features/custom-code/customCode.service.js");
let env: typeof import("../../../src/config/env.js").env;
let repository: typeof import("../../../src/features/automation/automation.repository.js");
let saved: { enabled: boolean; token: string };
let owner: { workflowId: string; blockId: string; runId: string };
const fetch = vi.fn();
const job = { id: "11111111-1111-4111-8111-111111111111", workflowId: "workflow", blockId: "block", scriptId: "test-script", mode: "bounded", status: "running", logs: "", result: null, error: null };

beforeAll(async () => {
  const database = await setupTestDatabase();
  teardown = database.teardown;
  env = (await import("../../../src/config/env.js")).env;
  service = await import("../../../src/features/custom-code/customCode.service.js");
  repository = await import("../../../src/features/automation/automation.repository.js");
});
afterAll(() => teardown());
beforeEach(() => {
  saved = { enabled: env.customCodeEnabled, token: env.scriptHelperToken };
  env.customCodeEnabled = true;
  env.scriptHelperToken = "test-runner-token";
  const workflow = repository.createAutomationWorkflow({ name: "Script owner", enabled: false, blocks: [{ type: "run_custom_code", config: { scriptId: "test-script" } }] });
  owner = { workflowId: workflow.id, blockId: repository.listAutomationBlocks(workflow.id)[0].id, runId: "run" };
  fetch.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/scripts")) return Response.json({ items: [{ id: "test-script", name: "Test", capabilities: [] }], errors: [] });
    if (url.endsWith("/run")) return Response.json({ job, action: "started" });
    if (url.endsWith(`/jobs/${job.id}`)) return Response.json({ job: { ...job, status: "success", result: { answer: 42 } } });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  service.stopCustomCodeReconciler();
  repository.updateAutomationWorkflow(owner.workflowId, { enabled: false });
  env.customCodeEnabled = saved.enabled;
  env.scriptHelperToken = saved.token;
  vi.unstubAllGlobals();
});

describe("custom-code runner boundary", () => {
  it("passes exact historic run/block filters to the helper before list limits", async () => {
    fetch.mockResolvedValueOnce(Response.json({ items: [job] }));
    const result = await service.listCustomCodeJobs({ workflowId: owner.workflowId, runId: "run:1", blockId: owner.blockId });
    expect(result.items).toEqual([job]);
    const query = new URL(fetch.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(query)).toEqual({ workflowId: owner.workflowId, runId: "run:1", blockId: owner.blockId });
    await expect(service.listCustomCodeJobs({ runId: "x".repeat(101) })).rejects.toThrow(/filter/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for bounded completion and passes structured inputs and only the helper token", async () => {
    const result = await service.runCustomCode({ scriptId: "test-script" }, owner, { lux: 12.5 });
    expect(result.job.result).toEqual({ answer: 42 });
    expect(result.action).toBe("completed");
    const call = fetch.mock.calls.find(([url]) => url.endsWith("/run"))!;
    expect(JSON.parse(call[1].body)).toMatchObject({ inputs: { lux: 12.5 }, mode: "bounded", timeoutSeconds: 30 });
    expect(call[1].headers.Authorization).toBe("Bearer test-runner-token");
  });

  it("returns immediately in background mode and sends input-update policy", async () => {
    repository.updateAutomationWorkflow(owner.workflowId, { enabled: true });
    const result = await service.runCustomCode({ scriptId: "test-script", executionMode: "background", onRunning: "update", timeoutSeconds: null }, owner, {});
    expect(result.job.status).toBe("running");
    expect(fetch.mock.calls.some(([url]) => url.includes("/jobs/"))).toBe(false);
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith("/run"))![1].body)).toMatchObject({ mode: "background", onRunning: "update", timeoutSeconds: null });
  });

  it("fails the waiting workflow on a later script error", async () => {
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url: string, init: RequestInit) => url.endsWith(`/jobs/${job.id}`)
      ? Response.json({ job: { ...job, status: "failed", error: "Script failed" } }) : original(url, init));
    await expect(service.runCustomCode({ scriptId: "test-script" }, owner, {})).rejects.toThrow(/failed/);
  });

  it("rejects invalid config, missing scripts, disabled support and undeclared display targets", async () => {
    expect(service.customCodeConfigError({ scriptId: "../code" })).toMatch(/Select/);
    for (const timeoutSeconds of [0, -1, Infinity, NaN, 3601, null]) expect(service.customCodeConfigError({ scriptId: "test-script", timeoutSeconds })).not.toBeNull();
    expect(service.customCodeConfigError({ scriptId: "test-script", executionMode: "background", timeoutSeconds: null })).toBeNull();
    expect(service.customCodeConfigError({ scriptId: "test-script", inputsJsonText: "bad" })).toMatch(/JSON/);
    await expect(service.runCustomCode({ scriptId: "missing" }, owner, {})).rejects.toThrow(/missing/);
    env.customCodeEnabled = false;
    await expect(service.listCustomScripts()).rejects.toThrow(/disabled/);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/run"))).toHaveLength(0);
  });

  it("authenticates stop requests and rejects non-ID paths", async () => {
    await service.stopCustomCodeJob(job.id);
    expect(fetch.mock.calls[0][0]).toContain(`/jobs/${job.id}/stop`);
    await expect(service.stopCustomCodeJob("../shell")).rejects.toThrow(/ID/);
    const workflow = repository.createAutomationWorkflow({ name: "Stop code", enabled: true, blocks: [{ type: "run_custom_code", config: {} }] });
    const block = repository.listAutomationBlocks(workflow.id)[0];
    await service.stopCustomCodeOwner(workflow.id, block.id);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ workflowId: workflow.id, blockId: block.id });
    fetch.mockRejectedValueOnce(new Error("runner offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(service.stopCustomCodeOwner(workflow.id, block.id)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/reconciliation/));
    } finally { log.mockRestore(); }
    repository.updateAutomationWorkflow(workflow.id, { enabled: false });
  });

  it("rejects background jobs on paused workflows and stops a job if its owner changes in flight", async () => {
    await expect(service.runCustomCode({ scriptId: "test-script", executionMode: "background" }, owner, {})).rejects.toThrow(/Enable the workflow/);
    repository.updateAutomationWorkflow(owner.workflowId, { enabled: true });
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/run")) repository.updateAutomationWorkflow(owner.workflowId, { enabled: false });
      return original(url, init);
    });
    await expect(service.runCustomCode({ scriptId: "test-script", executionMode: "background" }, owner, {})).rejects.toThrow(/changed/);
    expect(fetch.mock.calls.some(([url]) => url.endsWith(`/jobs/${job.id}/stop`))).toBe(true);
  });

  it("reconciles only enabled unarchived script-block owners", async () => {
    const workflow = repository.createAutomationWorkflow({ name: "Code", enabled: true, blocks: [{ type: "manual_start", config: {} }, { type: "run_custom_code", config: { scriptId: "test-script" } }, { type: "run_custom_code", config: {}, enabled: false }] });
    await service.reconcileCustomCodeJobs();
    const body = JSON.parse(fetch.mock.calls.at(-1)![1].body);
    expect(body.owners).toEqual([{ workflowId: workflow.id, blockId: repository.listAutomationBlocks(workflow.id)[1].id }]);
    repository.updateAutomationWorkflow(workflow.id, { enabled: false });
    await service.reconcileCustomCodeJobs();
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).owners).toEqual([]);
  });
});
