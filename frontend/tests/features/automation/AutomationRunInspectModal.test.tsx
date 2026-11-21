import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationRunInspectModal } from "../../../src/features/automation/AutomationRunInspectModal";
import type { AutomationBlockRun, AutomationRun } from "../../../src/features/automation/automationTypes";
vi.mock("../../../src/features/automation/customCodeApi", () => ({
  getScriptJob: vi.fn().mockRejectedValue(new Error("Runner unavailable")),
  findScriptJobs: vi.fn().mockResolvedValue({ items: [] }),
  stopScriptJob: vi.fn(),
}));

function blockRun(overrides: Partial<AutomationBlockRun> = {}): AutomationBlockRun {
  return {
    id: "br1",
    runId: "r1",
    workflowId: "w1",
    blockId: "b1",
    order: 0,
    blockType: "wait",
    blockLabel: "Wait",
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:01.000Z",
    status: "success",
    durationMs: 1000,
    input: null,
    output: null,
    error: null,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "r1",
    workflowId: "w1",
    workflowName: "Front gate flow",
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:01.000Z",
    status: "success",
    triggerType: "manual",
    triggerSourceId: null,
    triggerPayload: null,
    durationMs: 1000,
    blockCount: 1,
    error: null,
    blocks: [blockRun()],
    ...overrides,
  };
}

describe("AutomationRunInspectModal", () => {
  it("includes the preserved script job and complete logs in failed-run details", async () => {
    render(<AutomationRunInspectModal run={run({ status: "failed", error: "Custom script failed", blocks: [blockRun({
      status: "failed", blockType: "run_custom_code", error: "Custom script failed",
      errorDetails: { domain: "block", type: "block_failed", message: "Custom script failed", nativeMessage: "TypeError: expected a number" },
      output: { output: { action: "failed", job: { id: "job-123", status: "failed", exitCode: 1, logs: "first log line\nTypeError: expected a number" } } },
    })] })} onClose={() => {}} />);
    expect(screen.getByText("Script jobs")).toBeInTheDocument();
    await screen.findByText(/Showing the job snapshot/);
    expect(screen.getByRole("dialog")).toHaveTextContent("first log line");
    expect(screen.getByRole("dialog")).toHaveTextContent("job-123");
    expect(screen.getByRole("dialog")).toHaveTextContent("TypeError: expected a number");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the workflow name, status, trigger, duration, and block count", () => {
    render(<AutomationRunInspectModal run={run()} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Front gate flow workflow" });
    expect(within(dialog).getByText("Success")).toBeInTheDocument();
    expect(within(dialog).getByText("manual")).toBeInTheDocument();
    expect(within(dialog).getByText("1.0 s")).toBeInTheDocument();
    expect(within(dialog).getByText("1/1")).toBeInTheDocument();
  });

  it("does not show an error section or failed block row for a successful run", () => {
    render(<AutomationRunInspectModal run={run()} onClose={() => {}} />);
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.queryByText("Block errors")).not.toBeInTheDocument();
  });

  it("shows the run-level error and the failed block label when the run failed", () => {
    const failedRun = run({
      status: "failed",
      error: "Upstream request failed",
      blocks: [blockRun({ status: "failed", error: "Timed out", blockLabel: "Fetch source" })],
    });
    render(<AutomationRunInspectModal run={failedRun} onClose={() => {}} />);

    expect(screen.getByText("Fetch source")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Upstream request failed")).toBeInTheDocument();
  });

  it("falls back to the first failed block's error when there is no run-level error", () => {
    const failedRun = run({
      status: "failed",
      error: null,
      blocks: [blockRun({ status: "failed", error: "Block boom", blockLabel: "Wait" })],
    });
    render(<AutomationRunInspectModal run={failedRun} onClose={() => {}} />);

    expect(screen.getAllByText("Block boom").length).toBeGreaterThan(0);
  });

  it("shows a block errors section listing every failed block's error", () => {
    const failedRun = run({
      status: "failed",
      error: "top-level",
      blocks: [
        blockRun({ id: "br1", status: "failed", error: "First failure", blockLabel: "Fetch" }),
        blockRun({ id: "br2", status: "failed", error: "Second failure", blockLabel: "Stamp" }),
      ],
    });
    render(<AutomationRunInspectModal run={failedRun} onClose={() => {}} />);

    expect(screen.getByText("Block errors")).toBeInTheDocument();
    expect(screen.getByText("First failure")).toBeInTheDocument();
    expect(screen.getByText("Second failure")).toBeInTheDocument();
  });

  it("always shows a Run data disclosure with the raw run JSON", () => {
    render(<AutomationRunInspectModal run={run()} onClose={() => {}} />);
    expect(screen.getByText("Run data")).toBeInTheDocument();
  });

  it("calls onClose when the modal is closed", async () => {
    const onClose = vi.fn();
    render(<AutomationRunInspectModal run={run()} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
