import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "../../config/env.js";
import { redactDeep } from "../../shared/redact.js";
import { getDataSource } from "../data-sources/dataSources.repository.js";
import { parseSpiDisplayConfig } from "../data-sources/dataSources.service.js";
import { getAutomationBlock, getAutomationWorkflow, listAutomationBlocks, listAutomationWorkflows } from "../automation/automation.repository.js";

export type CustomCodeConfig = {
  scriptId?: string;
  executionMode?: "bounded" | "background";
  onRunning?: "keep" | "restart" | "update";
  timeoutSeconds?: number | null;
  inputsJsonText?: string;
  targetId?: string;
};
export type Script = { id: string; name: string; capabilities: string[] };
export type ScriptJob = { id: string; workflowId: string; blockId: string; scriptId: string; mode: string; status: string; logs: string; result: unknown; error: string | null };

const session = crypto.randomUUID();
let initialized: Promise<unknown> | null = null;
let heartbeat: NodeJS.Timeout | null = null;
const boundedOwners = new Map<string, { workflowId: string; blockId: string; wasEnabled: boolean }>();

async function request<T>(path: string, payload?: unknown): Promise<T> {
  if (!env.customCodeEnabled || !env.scriptHelperToken) throw new Error("Custom code is disabled or not configured. Follow the installed-script setup guide.");
  const response = await fetch(`${env.scriptHelperUrl.replace(/\/$/, "")}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${env.scriptHelperToken}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const result = redactDeep(await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || `Script helper returned HTTP ${response.status}`);
  return result as T;
}

function ensureSession() {
  if (!initialized) {
    initialized = request("/reconcile", { session, owners: [] }).catch((error: unknown) => {
      initialized = null;
      throw error;
    });
  }
  return initialized;
}

export async function listCustomScripts() {
  return request<{ items: Script[]; errors: { id: string; error: string }[] }>("/scripts");
}

export async function listCustomCodeJobs() {
  return request<{ items: ScriptJob[] }>("/jobs");
}

export async function getCustomCodeJob(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid job ID");
  return request<{ job: ScriptJob }>(`/jobs/${id}`);
}

export async function stopCustomCodeJob(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid job ID");
  return request<{ job: ScriptJob }>(`/jobs/${id}/stop`, {});
}

export async function stopCustomCodeOwner(workflowId: string, blockId?: string) {
  if (!env.customCodeEnabled) return;
  if (!listAutomationBlocks(workflowId).some((block) => block.type === "run_custom_code" && (!blockId || block.id === blockId))) return;
  try { await request("/stop-owner", { workflowId, blockId }); }
  catch { console.error("Immediate custom-code stop failed; ownership reconciliation will retry and orphaned jobs expire."); }
}

export function customCodeConfigError(config: CustomCodeConfig): string | null {
  if (!config.scriptId || !/^[a-z][a-z0-9-]{0,63}$/.test(config.scriptId)) return "Select an installed script.";
  if (config.executionMode !== undefined && config.executionMode !== "bounded" && config.executionMode !== "background") return "Select a valid execution mode.";
  if (config.onRunning !== undefined && !["keep", "restart", "update"].includes(config.onRunning)) return "Select a valid repeated-trigger policy.";
  const timeout = config.timeoutSeconds === undefined ? 30 : config.timeoutSeconds;
  if (timeout === null && config.executionMode !== "background") return "Bounded scripts require a time limit.";
  if (timeout !== null && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1 || timeout > 3600)) return "Time limit must be 1 to 3600 seconds.";
  try {
    if (Buffer.byteLength(config.inputsJsonText ?? "{}") > 16384) return "Script inputs exceed 16 KiB.";
    JSON.parse(config.inputsJsonText ?? "{}");
  } catch { return "Script inputs must be valid JSON."; }
  return null;
}

export async function runCustomCode(config: CustomCodeConfig, owner: { workflowId: string; blockId: string; runId: string }, inputs: unknown) {
  const workflow = getAutomationWorkflow(owner.workflowId);
  const block = getAutomationBlock(owner.blockId);
  if (!workflow || !block || block.workflow_id !== workflow.id || !block.enabled || block.type !== "run_custom_code" || workflow.archived) throw new Error("Workflow or script block is no longer active");
  if (config.executionMode === "background" && !workflow.enabled) throw new Error("Enable the workflow before starting a background script");
  const isCurrent = () => {
    const latest = getAutomationWorkflow(owner.workflowId);
    const latestBlock = getAutomationBlock(owner.blockId);
    return latest && !latest.archived && (!workflow.enabled || latest.enabled) && latestBlock?.enabled && latestBlock.config_json === block.config_json;
  };
  const error = customCodeConfigError(config);
  if (error) throw new Error(error);
  if (Buffer.byteLength(JSON.stringify(inputs)) > 16384) throw new Error("Resolved script inputs exceed 16 KiB");
  const scripts = await listCustomScripts();
  const script = scripts.items.find((item) => item.id === config.scriptId);
  if (!script) throw new Error("Script is missing or invalid. Refresh installed scripts.");
  let display;
  if (script.capabilities.includes("display")) {
    const target = config.targetId ? getDataSource(config.targetId) : undefined;
    if (!env.displaysEnabled || target?.type !== "spi-display") throw new Error("This script requires enabled SPI displays and a configured PIM576 target");
    display = parseSpiDisplayConfig(JSON.parse(target.config) as unknown);
  }
  await ensureSession();
  if (!isCurrent()) throw new Error("Workflow or script block changed before execution");
  const key = `${owner.workflowId}:${owner.blockId}`;
  boundedOwners.set(key, { ...owner, wasEnabled: Boolean(workflow.enabled) });
  try {
    const started = await request<{ job: ScriptJob; action: string }>("/run", {
      ...owner, session, scriptId: script.id, mode: config.executionMode ?? "bounded",
      onRunning: config.onRunning ?? "keep", timeoutSeconds: config.timeoutSeconds === undefined ? 30 : config.timeoutSeconds,
      inputs, ...(display ? { display } : {}),
    });
    if (!isCurrent()) {
      await stopCustomCodeJob(started.job.id);
      throw new Error("Workflow or script block changed during execution");
    }
    if (config.executionMode === "background") return started;
    let job = started.job;
    while (job.status === "running" || job.status === "starting") {
      await delay(250);
      job = (await getCustomCodeJob(job.id)).job;
      if (!isCurrent()) {
        await stopCustomCodeJob(job.id);
        throw new Error("Workflow or script block changed during execution");
      }
    }
    if (job.status !== "success") throw new Error(`Custom script ${job.status}: ${job.error ?? "check job logs"}`);
    return { job, action: "completed" };
  } finally {
    boundedOwners.delete(key);
  }
}

export async function reconcileCustomCodeJobs() {
  if (!env.customCodeEnabled) return;
  await ensureSession();
  const owners = listAutomationWorkflows().filter((item) => item.enabled && !item.archived).flatMap((workflow) =>
    listAutomationBlocks(workflow.id).filter((block) => block.enabled && block.type === "run_custom_code").map((block) => ({ workflowId: workflow.id, blockId: block.id })),
  );
  const activeBounded = [...boundedOwners.values()].filter((owner) => {
    const workflow = getAutomationWorkflow(owner.workflowId);
    return workflow && !workflow.archived && (!owner.wasEnabled || workflow.enabled) && getAutomationBlock(owner.blockId)?.enabled;
  });
  await request("/reconcile", { session, owners: [...owners, ...activeBounded] });
}

export function startCustomCodeReconciler() {
  if (!env.customCodeEnabled || heartbeat) return;
  let pending = false;
  const reconcile = async () => {
    if (pending) return;
    pending = true;
    try { await reconcileCustomCodeJobs(); }
    catch { console.error("Custom-code reconciliation failed; orphaned jobs will expire."); }
    finally { pending = false; }
  };
  void reconcile();
  heartbeat = setInterval(() => void reconcile(), 10000);
}

export function stopCustomCodeReconciler() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}
