import { db } from "../../db/database.js";
import { recordAuditEvent } from "../auth/audit.service.js";
import { getSetting, saveSetting } from "./settings.repository.js";

const key = "developer_diagnostics_settings";
export const DEVELOPER_DIAGNOSTICS_DURATIONS = [15, 60, 1440] as const;

type StoredDeveloperDiagnosticsSettings = { enabledUntil: string | null };
export type DeveloperDiagnosticsSettings = StoredDeveloperDiagnosticsSettings & { enabled: boolean };

export class DeveloperDiagnosticsValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Check the developer diagnostics settings.");
  }
}

function disabled(): DeveloperDiagnosticsSettings {
  return { enabled: false, enabledUntil: null };
}

function parseStored(value: string, now: number): DeveloperDiagnosticsSettings {
  if (!value) return disabled();
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.enabledUntil === null) return disabled();
    if (typeof parsed.enabledUntil !== "string") return disabled();
    const deadline = Date.parse(parsed.enabledUntil);
    if (!Number.isFinite(deadline) || deadline <= now) return disabled();
    return { enabled: true, enabledUntil: new Date(deadline).toISOString() };
  } catch {
    return disabled();
  }
}

export function getDeveloperDiagnosticsSettings(now = Date.now()): DeveloperDiagnosticsSettings {
  return parseStored(getSetting(key), now);
}

export function isDeveloperDiagnosticsEnabled(now = Date.now()) {
  return getDeveloperDiagnosticsSettings(now).enabled;
}

export function saveDeveloperDiagnosticsSettings(input: unknown, userId?: string, now = Date.now()) {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof value.enabled !== "boolean")
    throw new DeveloperDiagnosticsValidationError({ enabled: "Choose whether developer diagnostics are enabled." });

  let stored: StoredDeveloperDiagnosticsSettings = { enabledUntil: null };
  if (value.enabled) {
    if (!DEVELOPER_DIAGNOSTICS_DURATIONS.includes(value.durationMinutes as never)) {
      throw new DeveloperDiagnosticsValidationError({ durationMinutes: "Choose 15 minutes, 1 hour, or 24 hours." });
    }
    stored = { enabledUntil: new Date(now + (value.durationMinutes as number) * 60000).toISOString() };
  }

  return db.transaction(() => {
    const previous = getDeveloperDiagnosticsSettings(now);
    saveSetting(key, JSON.stringify(stored));
    const settings = parseStored(JSON.stringify(stored), now);
    recordAuditEvent("settings.developer_diagnostics_changed", {
      userId,
      detail: JSON.stringify({ previous, settings }),
    });
    return settings;
  }).immediate();
}
