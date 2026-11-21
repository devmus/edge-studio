import type { AutomationBlockType } from "./automation.repository.js";

// Fixed security policy; not operator-configurable. See docs/adr/0022-bound-external-automation-effects.md.
export const WORKFLOW_RUN_BUDGET_MAX_RUNS = 1000;
export const DISPLAY_WORKFLOW_RUN_BUDGET_MAX_RUNS = 5000;
export const WORKFLOW_RUN_BUDGET_WINDOW_MS = 60 * 60 * 1000;

export const PRIVILEGED_AUTOMATION_BLOCK_TYPES: ReadonlySet<AutomationBlockType> = new Set<AutomationBlockType>([
  "send_transaction",
  "control_output",
  "run_custom_code",
  "capture_camera",
  "stamp_integritas"
]);

export function isPrivilegedAutomationBlock(type: AutomationBlockType) {
  return PRIVILEGED_AUTOMATION_BLOCK_TYPES.has(type);
}

export function workflowRunBudgetLimit(blocks: ReadonlyArray<{ type: AutomationBlockType; config_json: string; enabled?: number | boolean }>, targetType: (id: string) => string | undefined): number {
  const privileged = blocks.filter((block) => block.enabled !== 0 && block.enabled !== false && isPrivilegedAutomationBlock(block.type));
  const displayOnly = privileged.length > 0 && privileged.every((block) => {
    if (block.type !== "control_output") return false;
    try {
      const config = JSON.parse(block.config_json) as { targetId?: unknown; action?: unknown };
      return config.action === "display_text" && typeof config.targetId === "string" && targetType(config.targetId) === "spi-display";
    } catch {
      return false;
    }
  });
  return displayOnly ? DISPLAY_WORKFLOW_RUN_BUDGET_MAX_RUNS : WORKFLOW_RUN_BUDGET_MAX_RUNS;
}

export function isEventStartBlock(type: AutomationBlockType) {
  return type === "gpio_event_start" || type === "webhook_event_start" || type === "mqtt_event_start";
}

/** Event-started workflows that send transactions need a whole-second cooldown of at least 1. */
export function isValidTransactionCooldown(cooldownSeconds: unknown) {
  return typeof cooldownSeconds === "number" && Number.isInteger(cooldownSeconds) && cooldownSeconds >= 1;
}
