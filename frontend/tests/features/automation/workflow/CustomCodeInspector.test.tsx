import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomCodeInspector } from "../../../../src/features/automation/workflow/CustomCodeInspector";
import type { DataSource } from "../../../../src/features/data-sources/dataSourceTypes";

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
    const view = render(<CustomCodeInspector config={{ scriptId: "animate-lux" }} sources={[]} onChange={onChange} />);
    await screen.findByRole("option", { name: "Animate light level" });
    expect(screen.getByRole("combobox", { name: "Execution mode" })).toHaveValue("bounded");
    expect(screen.queryByRole("combobox", { name: "When already running" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Execution mode" }), "background");
    expect(onChange).toHaveBeenCalledWith({ scriptId: "animate-lux", executionMode: "background", timeoutSeconds: 30 });
    view.rerender(<CustomCodeInspector config={{ scriptId: "animate-lux", executionMode: "background" }} sources={[]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "When already running" }), "update");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ onRunning: "update" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Time limit, seconds" }), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: null }));
    fireEvent.change(screen.getByRole("textbox", { name: "Inputs JSON" }), { target: { value: '{"lux":"{{lux}}"}' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ inputsJsonText: '{"lux":"{{lux}}"}' }));
  });

  it("keeps Edit configuration-only and refreshes discovery without loading jobs", async () => {
    render(<CustomCodeInspector config={{}} sources={[]} onChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Animate light level" });
    expect(screen.queryByRole("button", { name: "Stop job" })).not.toBeInTheDocument();
    expect(screen.queryByText("Logs and result")).not.toBeInTheDocument();
    const previous = fetch.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh scripts" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(previous));
    expect(fetch.mock.calls.every(([url]) => url === "/api/custom-code/scripts")).toBe(true);
  });

  it("shows capability-filtered Device access only for scripts that require it", async () => {
    fetch.mockResolvedValue(Response.json({ items: [{ id: "animate-lux", name: "Animate light level", capabilities: ["display.frames"] }], errors: [] }));
    const display = { id: "lcd", name: "Desk display", type: "spi-display", config: { model: "pim576", rotation: 0 } } as DataSource;
    const gpio = { id: "led", name: "Status LED", type: "gpio-output", config: { pin: 18 } } as DataSource;
    const onChange = vi.fn();
    render(<CustomCodeInspector config={{ scriptId: "animate-lux" }} sources={[display, gpio]} onChange={onChange} />);
    const access = await screen.findByRole("combobox", { name: "Device access" });
    expect(screen.getByRole("option", { name: "Desk display" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Status LED" })).not.toBeInTheDocument();
    await userEvent.selectOptions(access, "lcd");
    expect(onChange).toHaveBeenCalledWith({ scriptId: "animate-lux", targetId: "lcd" });
  });

  it("hides Device access for general scripts even when a stale target is saved", async () => {
    render(<CustomCodeInspector config={{ scriptId: "animate-lux", targetId: "old-device" }} sources={[]} onChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Animate light level" });
    expect(screen.queryByRole("combobox", { name: "Device access" })).not.toBeInTheDocument();
  });

  it("preserves a missing selection and explains unavailable support", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CustomCodeInspector config={{ scriptId: "missing" }} sources={[]} onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Custom code is unavailable");
    expect(screen.getByRole("combobox", { name: "Script" })).toHaveValue("missing");
  });
});
