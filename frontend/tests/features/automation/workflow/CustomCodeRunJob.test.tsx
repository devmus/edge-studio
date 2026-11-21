import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomCodeRunJob } from "../../../../src/features/automation/workflow/CustomCodeRunJob";
import type { AutomationBlockRun } from "../../../../src/features/automation/automationTypes";
import type { ScriptJob } from "../../../../src/features/automation/customCodeApi";

const first: ScriptJob = { id: "11111111-1111-4111-8111-111111111111", workflowId: "w1", blockId: "b1", runId: "r1", scriptId: "animate-lux", status: "success", logs: "First run log", result: { lux: 12.5 }, error: null };
const second: ScriptJob = { ...first, id: "22222222-2222-4222-8222-222222222222", runId: "r2", logs: "Second run log", result: { lux: 150 } };
const fetch = vi.fn();

function blockRun(runId = "r1", job: ScriptJob | null = first, overrides: Partial<AutomationBlockRun> = {}): AutomationBlockRun {
  return { id: `block-run-${runId}`, runId, workflowId: "w1", blockId: "b1", order: 1, blockType: "run_custom_code", blockLabel: "Run code", startedAt: "2026-11-21T11:31:24.263Z", finishedAt: "2026-11-21T11:31:25.263Z", durationMs: 1000, status: "success", input: {}, output: job ? { output: { action: "completed", job } } : null, error: null, ...overrides };
}

beforeEach(() => {
  fetch.mockReset().mockImplementation(async (url: string) => Response.json({ job: url.includes(second.id) ? second : first }));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Watch script jobs", () => {
  it("loads only the job linked to the selected historic block run", async () => {
    const view = render(<CustomCodeRunJob blockRun={blockRun()} />);
    await screen.findByText("Current job status");
    expect(screen.getByText("First run log")).toBeInTheDocument();
    view.rerender(<CustomCodeRunJob blockRun={blockRun("r2", second)} />);
    await screen.findByText("Second run log");
    expect(screen.queryByText("First run log")).not.toBeInTheDocument();
    expect(fetch.mock.calls.every(([url]) => url === `/api/custom-code/jobs/${first.id}` || url === `/api/custom-code/jobs/${second.id}`)).toBe(true);
  });

  it("ignores a late job response after a different history run is selected", async () => {
    let finish!: (response: Response) => void;
    fetch.mockImplementation(async (url: string) => url.includes(first.id) ? new Promise<Response>((resolve) => { finish = resolve; }) : Response.json({ job: second }));
    const view = render(<CustomCodeRunJob blockRun={blockRun()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    view.rerender(<CustomCodeRunJob blockRun={blockRun("r2", second)} />);
    await screen.findByText("Current job status");
    await act(async () => { finish(Response.json({ job: first })); });
    expect(screen.getByText("Second run log")).toBeInTheDocument();
    expect(screen.queryByText("First run log")).not.toBeInTheDocument();
  });

  it("shows later background failure without changing the recorded start acknowledgement", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const started = { ...first, mode: "background", status: "running", logs: "Rendering", result: null };
    const failed = { ...started, status: "failed", logs: "Animation traceback\nTypeError: expected a number", error: "Script failed" };
    fetch.mockResolvedValueOnce(Response.json({ job: started })).mockResolvedValue(Response.json({ job: failed }));
    render(<CustomCodeRunJob blockRun={blockRun("r1", started, { output: { output: { action: "started", job: started } } })} />);
    await screen.findByText("Current job status");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("Script failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View job error details" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("TypeError: expected a number");
  });

  it("stops a reused live job by its ID and preserves its run association", async () => {
    const live = { ...first, runId: "original-run", mode: "background", status: "running" };
    let stopped = false;
    fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") stopped = true;
      return Response.json({ job: { ...live, status: stopped ? "stopped" : "running" } });
    });
    render(<CustomCodeRunJob blockRun={blockRun("r1", live, { output: { output: { action: "updated", job: live } } })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop job" }));
    await screen.findByText("stopped");
    expect(screen.getByText("updated")).toBeInTheDocument();
    expect(screen.getByText(/started by run original-run/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, init]) => url === `/api/custom-code/jobs/${first.id}/stop` && init?.method === "POST")).toBe(true);
  });

  it("finds older missing snapshots by exact run/block association and fetches full logs", async () => {
    const full = { ...first, logs: `Beginning of full log\n${"x".repeat(1500)}\nLast log line` };
    fetch.mockImplementation(async (url: string) => Response.json(url.includes("?") ? { items: [second, { ...first, logs: "Truncated tail" }] } : { job: full }));
    render(<CustomCodeRunJob blockRun={blockRun("r1", null, { status: "failed" })} />);
    await screen.findByText(/Beginning of full log/);
    const query = new URL(fetch.mock.calls[0][0], "http://test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ runId: "r1", blockId: "b1", workflowId: "w1" });
    expect(fetch.mock.calls[1][0]).toBe(`/api/custom-code/jobs/${first.id}`);
    expect(screen.queryByText("Second run log")).not.toBeInTheDocument();
    expect(screen.queryByText("Truncated tail")).not.toBeInTheDocument();
  });

  it("keeps historical output readable when the helper is offline", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CustomCodeRunJob blockRun={blockRun()} />);
    await screen.findByText(/Showing the job snapshot/);
    expect(screen.getByText("First run log")).toBeInTheDocument();
    expect(screen.getByText("Logs and result recorded with this run")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop job" })).not.toBeInTheDocument();
  });

  it("labels cached live data as last retrieved and removes Stop when polling fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const live = { ...first, status: "running", logs: "Latest retrieved log" };
    fetch.mockResolvedValueOnce(Response.json({ job: live })).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CustomCodeRunJob blockRun={blockRun("r1", { ...first, status: "running" })} />);
    await screen.findByRole("button", { name: "Stop job" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("Last retrieved job status")).toBeInTheDocument();
    expect(screen.getByText("Latest retrieved log")).toBeInTheDocument();
    expect(screen.queryByText("Current job status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop job" })).not.toBeInTheDocument();
  });

  it("does not substitute another run's job when its retained record is gone", async () => {
    fetch.mockResolvedValue(Response.json({ items: [second] }));
    render(<CustomCodeRunJob blockRun={blockRun("r1", null)} />);
    await screen.findByText("No script job was recorded");
    expect(screen.queryByText("Second run log")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
