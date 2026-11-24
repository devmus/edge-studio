import { getJson, postJson } from "../../lib/api";

export type DeveloperDiagnosticsResponse = {
  settings: { enabled: boolean; enabledUntil: string | null };
  durationsMinutes: number[];
};

export function getDeveloperDiagnostics() {
  return getJson<DeveloperDiagnosticsResponse>("/api/settings/developer-diagnostics");
}

export function saveDeveloperDiagnostics(enabled: boolean, durationMinutes?: number) {
  return postJson<DeveloperDiagnosticsResponse>("/api/settings/developer-diagnostics", {
    enabled,
    ...(enabled ? { durationMinutes } : {}),
  });
}
