import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../src/components/ToastProvider";
import { DeveloperDiagnosticsPanel } from "../../../src/features/settings/DeveloperDiagnosticsPanel";

afterEach(() => vi.unstubAllGlobals());

describe("DeveloperDiagnosticsPanel", () => {
  it("enables bounded full capture and can turn it off", async () => {
    const enabledUntil = new Date(Date.now() + 60000).toISOString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: { enabled: false, enabledUntil: null }, durationsMinutes: [15, 60, 1440] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: { enabled: true, enabledUntil }, durationsMinutes: [15, 60, 1440] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: { enabled: false, enabledUntil: null }, durationsMinutes: [15, 60, 1440] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DeveloperDiagnosticsPanel />, { wrapper: ToastProvider });

    expect(await screen.findByRole("button", { name: "Enable developer diagnostics" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "15 minutes" }));
    await userEvent.click(screen.getByRole("button", { name: "Enable developer diagnostics" }));
    expect(await screen.findByText(/Developer diagnostics are on until/)).toHaveTextContent(enabledUntil);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/settings/developer-diagnostics", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ enabled: true, durationMinutes: 15 }),
    }));

    await userEvent.click(screen.getByRole("button", { name: "Turn off diagnostics" }));
    expect(await screen.findByRole("button", { name: "Enable developer diagnostics" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/settings/developer-diagnostics", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    }));
  });
});
