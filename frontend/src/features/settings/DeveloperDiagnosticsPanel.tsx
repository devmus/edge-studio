import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "../../components/Button";
import { ButtonRow } from "../../components/ButtonRow";
import { useToast } from "../../components/ToastProvider";
import { ErrorContentState } from "../../components/patterns/ErrorContentState";
import { LoadingState } from "../../components/patterns/LoadingState";
import { SubSection } from "../../components/patterns/SubSection";
import { ToggleTabs } from "../../components/ui/ToggleTabs";
import { describeLoadFailure } from "../../lib/errors";
import {
  getDeveloperDiagnostics,
  saveDeveloperDiagnostics,
  type DeveloperDiagnosticsResponse,
} from "./developerDiagnosticsApi";

function durationLabel(minutes: number) {
  if (minutes === 15) return "15 minutes";
  if (minutes === 60) return "1 hour";
  return "24 hours";
}

export function DeveloperDiagnosticsPanel() {
  const { showToast } = useToast();
  const [response, setResponse] = useState<DeveloperDiagnosticsResponse | null>(null);
  const [duration, setDuration] = useState("60");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setResponse(await getDeveloperDiagnostics());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load developer diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!response?.settings.enabledUntil) return;
    const delay = Date.parse(response.settings.enabledUntil) - Date.now();
    if (delay <= 0) {
      setResponse((current) => current ? { ...current, settings: { enabled: false, enabledUntil: null } } : current);
      return;
    }
    const timer = window.setTimeout(() => {
      setResponse((current) => current ? { ...current, settings: { enabled: false, enabledUntil: null } } : current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [response?.settings.enabledUntil]);

  async function save(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await saveDeveloperDiagnostics(enabled, enabled ? Number(duration) : undefined);
      setResponse(next);
      showToast({
        tone: "success",
        title: enabled ? "Developer diagnostics enabled" : "Developer diagnostics disabled",
        message: enabled
          ? "Every workflow run is retained until the displayed expiry."
          : "Routine scheduled checks will return to compact activity summaries.",
      });
    } catch (error) {
      showToast({
        tone: "error",
        title: "Developer diagnostics not changed",
        message: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubSection
      icon={<Bug size={13} aria-hidden />}
      title="Developer diagnostics"
      description="Temporarily retain detailed diagnostic activity without changing the installation's source-build or update mode."
    >
      {loading ? (
        <LoadingState title="Loading developer diagnostics" />
      ) : loadError ? (
        <ErrorContentState
          title="Developer diagnostics aren't available"
          description={describeLoadFailure(loadError)}
          onRetry={() => void load()}
        />
      ) : response ? (
        <div className="grid max-w-xl gap-4">
          {response.settings.enabled && response.settings.enabledUntil ? (
            <>
              <p className="type-body text-text-primary m-0">
                Developer diagnostics are on until {new Date(response.settings.enabledUntil).toLocaleString()} ({response.settings.enabledUntil}).
              </p>
              <p className="type-body text-text-secondary m-0">
                Every workflow run is retained in full and additional safe backend diagnostics are enabled. Redaction remains active, but diagnostic records can still contain private workflow values and use more storage.
              </p>
              <ButtonRow>
                <Button type="button" disabled={busy} onClick={() => void save(false)}>
                  {busy ? "Turning off…" : "Turn off diagnostics"}
                </Button>
              </ButtonRow>
            </>
          ) : (
            <>
              <ToggleTabs
                label="Capture duration"
                value={duration}
                options={response.durationsMinutes.map((minutes) => ({
                  value: String(minutes),
                  label: durationLabel(minutes),
                }))}
                onChange={setDuration}
              />
              <p className="type-body text-text-secondary m-0">
                Normal workflow history groups repeated scheduled checks that take no action. Enable diagnostics temporarily when troubleshooting to retain every run. It turns off automatically.
              </p>
              <ButtonRow>
                <Button type="button" disabled={busy} onClick={() => void save(true)}>
                  {busy ? "Enabling…" : "Enable developer diagnostics"}
                </Button>
              </ButtonRow>
            </>
          )}
        </div>
      ) : null}
    </SubSection>
  );
}
