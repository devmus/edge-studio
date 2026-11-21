import { useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { JsonPreviewContent } from "../../../components/JsonPreview";
import { EmptyContentState } from "../../../components/patterns/EmptyContentState";
import { ErrorContentState } from "../../../components/patterns/ErrorContentState";
import { ErrorDetailPanel } from "../../../components/patterns/ErrorDetailPanel";
import { LoadingState } from "../../../components/patterns/LoadingState";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Modal } from "../../../components/ui/Modal";
import { describeLoadFailure } from "../../../lib/errors";
import type { AutomationBlockRun } from "../automationTypes";
import { findScriptJobs, getScriptJob, stopScriptJob, type ScriptJob } from "../customCodeApi";
import { mutedText, RuntimeStat } from "./workflowWorkspaceUi";

function recordedJob(blockRun: AutomationBlockRun) {
  const output = blockRun.output as { output?: { action?: string; job?: ScriptJob } } | null;
  const job = output?.output?.job;
  if (!job || typeof job.id !== "string" || typeof job.status !== "string") return null;
  if (job.blockId && job.blockId !== blockRun.blockId) return null;
  if (job.workflowId && blockRun.workflowId && job.workflowId !== blockRun.workflowId) return null;
  return job;
}

function isRunning(job: ScriptJob) {
  return job.status === "starting" || job.status === "running";
}

/** Runtime data is scoped to a stored block run, never the editor's latest jobs. */
export function CustomCodeRunJob({ blockRun }: { blockRun: AutomationBlockRun }) {
  const snapshot = recordedJob(blockRun);
  const jobId = snapshot?.id;
  const { runId, blockId, workflowId } = blockRun;
  const key = `${runId}:${blockId}`;
  const [state, setState] = useState<{ key: string; job: ScriptJob | null; loading: boolean; error: string; stopping: boolean }>({ key, job: null, loading: true, error: "", stopping: false });
  const [refresh, setRefresh] = useState(0);
  const [errorJob, setErrorJob] = useState<ScriptJob | null>(null);
  const current = state.key === key ? state : { job: null, loading: true, error: "", stopping: false };

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((previous) => ({ key, job: previous.key === key ? previous.job : null, loading: true, error: "", stopping: false }));
    const load = async () => {
      try {
        let id = jobId;
        if (!id && blockId) {
          const found = await findScriptJobs({ runId, blockId, workflowId: workflowId ?? undefined });
          id = found.items.find((job) => job.runId === runId && job.blockId === blockId && (!workflowId || job.workflowId === workflowId))?.id;
        }
        const job = id ? (await getScriptJob(id)).job : null;
        if (job && (job.id !== id || (job.blockId && job.blockId !== blockId) || (workflowId && job.workflowId && job.workflowId !== workflowId))) throw new Error("Job does not belong to this block run.");
        if (!active) return;
        setState({ key, job, loading: false, error: "", stopping: false });
        if (job && isRunning(job)) timer = setTimeout(() => void load(), 3000);
      } catch (error) {
        if (active) setState((previous) => ({ ...previous, key, loading: false, error: describeLoadFailure(error) }));
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [key, jobId, blockId, runId, workflowId, refresh]);

  const job = current.job ?? snapshot;
  const retry = () => setRefresh((value) => value + 1);
  if (!job) {
    if (current.loading) return <LoadingState title="Loading script job" />;
    if (current.error) return <ErrorContentState title="Script job unavailable" description={current.error} onRetry={retry} />;
    return <EmptyContentState title="No script job was recorded" description="The script may not have started, or its older job record has expired. No other run's job is substituted." />;
  }
  const action = (blockRun.output as { output?: { action?: string } } | null)?.output?.action;
  return <div className="gap-detail-next grid">
    <RuntimeStat label="Job ID" value={<span className="break-all">{job.id}</span>} />
    <RuntimeStat label="Action in this run" value={snapshot ? action ?? "Not recorded" : "Started (linked by run ID)"} />
    <RuntimeStat label="Status at this run" value={snapshot?.status ?? "Not stored"} />
    {current.job && <RuntimeStat label={current.error ? "Last retrieved job status" : "Current job status"} value={current.job.status} />}
    {job.runId && job.runId !== runId && <p className={mutedText}>This run reused or updated a job started by run {job.runId}. Its current logs and result can include later updates.</p>}
    {current.error && <ErrorAlert action={<Button variant="secondary" size="sm" onClick={retry}>Retry job</Button>}>{current.error} {current.job ? "Showing the last retrieved job data." : "Showing the job snapshot recorded with this run."}</ErrorAlert>}
    {job.error && blockRun.status !== "failed" && <ErrorAlert action={<Button variant="secondary" size="sm" onClick={() => setErrorJob(job)}>View job error details</Button>}>{job.error}</ErrorAlert>}
    <Disclosure title={current.job ? current.error ? "Last retrieved job logs and result" : "Current job logs and result" : "Logs and result recorded with this run"}>
      <div className="gap-detail-next grid">
        <strong>Logs</strong>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{job.logs || "No logs recorded."}</pre>
        <strong>Result</strong>
        <JsonPreviewContent value={job.result ?? null} />
      </div>
    </Disclosure>
    {snapshot && <Disclosure title="Job snapshot recorded with this run" defaultOpen={false}><JsonPreviewContent value={snapshot} /></Disclosure>}
    <div className="gap-detail-next flex flex-wrap">
      <Button variant="secondary" size="sm" disabled={current.loading || current.stopping} onClick={retry}>Refresh job</Button>
      {job.error && blockRun.status === "failed" && <Button variant="secondary" size="sm" onClick={() => setErrorJob(job)}>View job error details</Button>}
      {current.job && !current.error && isRunning(current.job) && <Button variant="secondary" size="sm" disabled={current.loading || current.stopping} onClick={async () => {
        setState((previous) => ({ ...previous, stopping: true }));
        try {
          await stopScriptJob(current.job!.id);
          setRefresh((value) => value + 1);
        } catch (error) {
          setState((previous) => previous.key === key ? { ...previous, stopping: false, error: describeLoadFailure(error) } : previous);
        }
      }}>{current.stopping ? "Stopping job…" : "Stop job"}</Button>}
    </div>
    {current.job && !current.error && isRunning(current.job) && <p className={mutedText}>Stop affects the live job, including runs that share it. It does not disable the workflow.</p>}
    {errorJob && <Modal title="Script job error" onClose={() => setErrorJob(null)}><ErrorDetailPanel error={{ message: errorJob.error ?? `Script job ${errorJob.status}`, context: { jobId: errorJob.id, scriptId: errorJob.scriptId, status: errorJob.status, exitCode: errorJob.exitCode }, logs: errorJob.logs }} /></Modal>}
  </div>;
}
