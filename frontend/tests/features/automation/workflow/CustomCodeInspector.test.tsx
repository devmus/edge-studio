import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomCodeInspector } from "../../../../src/features/automation/workflow/CustomCodeInspector";

const fetch = vi.fn();
beforeEach(() => {
  fetch.mockReset().mockImplementation(async (url: string) => Response.json(url.endsWith("/scripts")
    ? { items: [{ id: "animate-lux", name: "Animate light level", capabilities: [] }], errors: [] }
    : { items: [{ id: "job-1", blockId: "block", status: "running", logs: "Ready", result: null, error: null }] }));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("custom-code block configuration", () => {
  it("discovers scripts, selects modes and supports background repeat/input/time controls", async () => {
    const onChange = vi.fn();
    const view = render(<CustomCodeInspector blockId="block" config={{ scriptId: "animate-lux" }} sources={[]} onChange={onChange} />);
    await screen.findByRole("option", { name: "Animate light level" });
    expect(screen.getByRole("combobox", { name: "Execution mode" })).toHaveValue("bounded");
    expect(screen.queryByRole("combobox", { name: "When already running" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Execution mode" }), "background");
    expect(onChange).toHaveBeenCalledWith({ scriptId: "animate-lux", executionMode: "background", timeoutSeconds: 30 });
    view.rerender(<CustomCodeInspector blockId="block" config={{ scriptId: "animate-lux", executionMode: "background" }} sources={[]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "When already running" }), "update");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ onRunning: "update" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time limit, seconds" }), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: null }));
    fireEvent.change(screen.getByRole("textbox", { name: "Inputs JSON" }), { target: { value: '{"lux":"{{lux}}"}' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ inputsJsonText: '{"lux":"{{lux}}"}' }));
  });

  it("shows running jobs, stops explicitly and refreshes discovery", async () => {
    render(<CustomCodeInspector blockId="block" config={{}} sources={[]} onChange={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop job" }));
    await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => url === "/api/custom-code/jobs/job-1/stop" && init?.method === "POST")).toBe(true));
    const previous = fetch.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh scripts" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(previous));
  });

  it("preserves a missing selection and explains unavailable support", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CustomCodeInspector blockId="block" config={{ scriptId: "missing" }} sources={[]} onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Custom code is unavailable");
    expect(screen.getByRole("combobox", { name: "Script" })).toHaveValue("missing");
  });
});
