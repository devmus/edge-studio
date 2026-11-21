import { useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { InputField } from "../../../components/ui/InputField";
import { SelectField } from "../../../components/ui/SelectField";
import { TextareaField } from "../../../components/ui/TextareaField";
import { getJson, postJson } from "../../../lib/api";
import type { DataSource } from "../../data-sources/dataSourceTypes";
import type { AutomationBlock } from "../automationTypes";
import { InspectorSection, errorText, formGridClass, mutedText } from "./workflowWorkspaceUi";

type Script = { id: string; name: string; capabilities: string[] };
type Job = { id: string; blockId: string; status: string; logs: string; error: string | null; result: unknown };

export function CustomCodeInspector({ blockId, config, sources, onChange }: {
  blockId: string;
  config: AutomationBlock["config"];
  sources: DataSource[];
  onChange: (config: AutomationBlock["config"]) => void;
}) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const [catalog, history] = await Promise.all([
          getJson<{ items: Script[]; errors: { id: string; error: string }[] }>("/api/custom-code/scripts"),
          getJson<{ items: Job[] }>("/api/custom-code/jobs"),
        ]);
        if (!current) return;
        setScripts(catalog.items);
        setJobs(history.items.filter((job) => job.blockId === blockId));
        setError(catalog.errors.map((item) => `${item.id}: ${item.error}`).join("; "));
      } catch {
        if (current) setError("Custom code is unavailable. Follow the installed-script setup guide and check the runner service.");
      } finally { pending = false; if (current) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { current = false; clearInterval(timer); };
  }, [blockId, refresh]);
  const background = config.executionMode === "background";
  const selected = scripts.find((script) => script.id === config.scriptId);
  return <InspectorSection title="Configuration" className={formGridClass}>
    <p className={mutedText}>Runs trusted installed Python, not a sandbox. Source lives in /opt/edge-studio-scripts. <a href="https://github.com/edge-studio-technology/edge-studio/blob/dev/docs/guides/custom-code.md" target="_blank" rel="noreferrer">Setup guide</a></p>
    {loading && <p className={mutedText}>Loading installed scripts…</p>}
    {error && <ErrorAlert>{error}</ErrorAlert>}
    <SelectField label="Script" value={config.scriptId ?? ""} placeholder="Select installed script…"
      options={[...scripts.map((script) => ({ value: script.id, label: script.name })), ...(config.scriptId && !selected ? [{ value: config.scriptId, label: `${config.scriptId} (missing)` }] : [])]}
      onChange={(event) => onChange({ ...config, scriptId: event.target.value })} />
    <Button variant="secondary" onClick={() => setRefresh((value) => value + 1)}>Refresh scripts</Button>
    <SelectField label="Execution mode" value={config.executionMode ?? "bounded"}
      options={[{ value: "bounded", label: "Wait for completion" }, { value: "background", label: "Run in background" }]}
      onChange={(event) => onChange({ ...config, executionMode: event.target.value as "bounded" | "background", timeoutSeconds: config.timeoutSeconds ?? 30 })} />
    {background && <SelectField label="When already running" value={config.onRunning ?? "keep"}
      options={[{ value: "keep", label: "Keep running" }, { value: "restart", label: "Restart with new inputs" }, { value: "update", label: "Update inputs" }]}
      onChange={(event) => onChange({ ...config, onRunning: event.target.value as "keep" | "restart" | "update" })} />}
    <InputField label="Time limit, seconds" value={config.timeoutSeconds === null ? "" : String(config.timeoutSeconds ?? 30)}
      description={background ? "1–3600 seconds; leave blank for no time limit." : "Required: 1–3600 seconds."}
      onChange={(event) => onChange({ ...config, timeoutSeconds: event.target.value === "" ? null : Number(event.target.value) })} />
    <TextareaField label="Inputs JSON" value={config.inputsJsonText ?? "{}"}
      onChange={(event) => onChange({ ...config, inputsJsonText: event.target.value })} />
    {selected?.capabilities.includes("display") && <SelectField label="Display target" value={config.targetId ?? ""} placeholder="Select PIM576…"
      options={sources.filter((source) => source.type === "spi-display").map((source) => ({ value: source.id, label: source.name }))}
      onChange={(event) => onChange({ ...config, targetId: event.target.value })} />}
    {background && <p className={mutedText}>Enable the workflow before starting a background job. Workflow success means started. Later errors appear on the job. Updates require the script to read input messages. Pausing/deleting the workflow stops its jobs; interrupted jobs are not automatically resumed.</p>}
    {jobs.slice(0, 10).map((job) => <div key={job.id} className="space-y-2 rounded border border-border-default p-3">
      <p className={mutedText}>Job {job.id}: {job.status}</p>
      {job.error && <p className={errorText}>{job.error}</p>}
      <details><summary>Logs and result</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{job.logs}{"\n"}{JSON.stringify(job.result, null, 2)}</pre></details>
      {["starting", "running"].includes(job.status) && <Button variant="secondary" onClick={async () => {
        try { await postJson(`/api/custom-code/jobs/${job.id}/stop`, {}); setRefresh((value) => value + 1); }
        catch { setError("Job could not be stopped. Check the runner service."); }
      }}>Stop job</Button>}
    </div>)}
  </InspectorSection>;
}
