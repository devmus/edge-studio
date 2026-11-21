import { getJson, postJson } from "../../lib/api";

export type ScriptJob = {
  id: string;
  workflowId?: string;
  blockId?: string;
  runId?: string;
  scriptId?: string;
  mode?: string;
  status: string;
  logs?: string;
  result?: unknown;
  error?: string | null;
  exitCode?: number | null;
};

export function getScriptJob(id: string) {
  return getJson<{ job: ScriptJob }>(`/api/custom-code/jobs/${encodeURIComponent(id)}`);
}

export function findScriptJobs(filter: { workflowId?: string; runId: string; blockId: string }) {
  const query = new URLSearchParams({ runId: filter.runId, blockId: filter.blockId });
  if (filter.workflowId) query.set("workflowId", filter.workflowId);
  return getJson<{ items: ScriptJob[] }>(`/api/custom-code/jobs?${query}`);
}

export function stopScriptJob(id: string) {
  return postJson<{ job: ScriptJob }>(`/api/custom-code/jobs/${encodeURIComponent(id)}/stop`, {});
}
