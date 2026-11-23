import { useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { InputField } from "../../../components/ui/InputField";
import { SelectField } from "../../../components/ui/SelectField";
import { TextareaField } from "../../../components/ui/TextareaField";
import { getJson } from "../../../lib/api";
import type { DataSource } from "../../data-sources/dataSourceTypes";
import type { AutomationBlock } from "../automationTypes";
import { InspectorSection, formGridClass, mutedText } from "./workflowWorkspaceUi";

type Script = { id: string; name: string; capabilities: string[] };

function requiresFrameDeviceAccess(script: Script | undefined) {
  return script?.capabilities.some((capability) => capability === "display.frames" || capability === "display") ?? false;
}

export function CustomCodeInspector({ config, sources, onChange }: {
  config: AutomationBlock["config"];
  sources: DataSource[];
  onChange: (config: AutomationBlock["config"]) => void;
}) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const catalog = await getJson<{ items: Script[]; errors: { id: string; error: string }[] }>("/api/custom-code/scripts");
        if (!current) return;
        setScripts(catalog.items);
        setError(catalog.errors.map((item) => `${item.id}: ${item.error}`).join("; "));
      } catch {
        if (current) setError("Custom code is unavailable. Follow the installed-script setup guide and check the runner service.");
      } finally { if (current) setLoading(false); }
    };
    void load();
    return () => { current = false; };
  }, [refresh]);
  const background = config.executionMode === "background";
  const selected = scripts.find((script) => script.id === config.scriptId);
  const compatibleDevices = sources.filter((source) => source.type === "spi-display" && source.config.model === "pim576");
  const selectedDevice = compatibleDevices.find((source) => source.id === config.targetId);
  return <InspectorSection title="Configuration" className={formGridClass}>
    <p className={mutedText}>Runs trusted installed Python, not a sandbox. Source lives in /opt/edge-studio-scripts. <a href="https://github.com/edge-studio-technology/edge-studio/blob/dev/docs/guides/custom-code.md" target="_blank" rel="noreferrer">Setup guide</a></p>
    {loading && <p className={mutedText}>Loading installed scripts…</p>}
    {error && <ErrorAlert>{error}</ErrorAlert>}
    <SelectField label="Script" value={config.scriptId ?? ""} placeholder="Select installed script…"
      options={[...scripts.map((script) => ({ value: script.id, label: script.name })), ...(config.scriptId && !selected ? [{ value: config.scriptId, label: `${config.scriptId} (missing)` }] : [])]}
      onChange={(event) => onChange({ ...config, scriptId: event.target.value })} />
    <Button variant="secondary" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Refresh scripts</Button>
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
    {requiresFrameDeviceAccess(selected) && <SelectField label="Device access" description="This script can send frames only to a compatible configured device." value={config.targetId ?? ""} placeholder="Select compatible device…"
      options={[...compatibleDevices.map((source) => ({ value: source.id, label: source.name })), ...(config.targetId && !selectedDevice ? [{ value: config.targetId, label: `${config.targetId} (missing or incompatible)` }] : [])]}
      onChange={(event) => onChange({ ...config, targetId: event.target.value })} />}
    {background && <p className={mutedText}>Enable the workflow before starting a background job. Workflow success means started. Later errors appear on the job. Updates require the script to read input messages. Pausing/deleting the workflow stops its jobs; interrupted jobs are not automatically resumed.</p>}
    <p className={mutedText}>Inspect job status, logs and results in Watch mode by selecting a historic run.</p>
  </InspectorSection>;
}
