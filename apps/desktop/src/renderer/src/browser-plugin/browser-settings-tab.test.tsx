import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { agentListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes";

const { getAgent, updateAgent, listAgents, listRuntimes, daemon, toastError } = vi.hoisted(() => ({
  getAgent: vi.fn(),
  updateAgent: vi.fn(),
  listAgents: vi.fn(),
  listRuntimes: vi.fn(),
  daemon: {
    current: { daemonId: "d1", deviceName: "pc", running: true } as {
      daemonId: string | null;
      deviceName: string | null;
      running: boolean;
    },
  },
  toastError: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: { getAgent, updateAgent, listAgents, listRuntimes },
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@multica/core/paths", () => ({ useWorkspaceSlug: () => "acme" }));
vi.mock("@multica/views/platform", () => ({ useLocalDaemonStatus: () => daemon.current }));
vi.mock("@elf-express/orca-browser/renderer", () => ({
  BrowserSettingsPanel: ({ scopeId }: { scopeId?: string }) => (
    <div data-testid="browser-settings-panel" data-scope-id={scopeId} />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { BrowserSettingsTab } from "./browser-settings-tab";

const G = { command: "gh" };
const E = {
  type: "http",
  url: "http://127.0.0.1:47821/mcp",
  headers: { Authorization: "Bearer t1" },
};

const rt = (id: string, daemon_id: string) =>
  ({
    id,
    daemon_id,
    runtime_mode: "local",
    provider: "claude",
    name: "Claude",
    custom_name: null,
  }) as AgentRuntime;
const ag = (id: string, name: string, runtime_id: string, over: Partial<Agent> = {}) =>
  ({ id, name, runtime_id, archived_at: null, mcp_config: null, ...over }) as Agent;

const agents = [
  ag("a1", "Claude Agent", "r1"),
  ag("a8", "Other Agent", "r1", { mcp_config: { mcpServers: { github: G, "orca-browser": E } } }),
  ag("a9", "Remote Agent", "r2"),
  ag("a7", "Shared Agent", "r1", { mcp_config_redacted: true }),
];
const runtimes = [rt("r1", "d1"), rt("r2", "d2")];

const getStatus = vi.fn();
const getEndpoint = vi.fn();
const rotateToken = vi.fn();

function isDisabled(el: HTMLElement) {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
}

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(agentListOptions("ws1").queryKey, agents);
  qc.setQueryData(runtimeListOptions("ws1").queryKey, runtimes);
  return render(
    <QueryClientProvider client={qc}>
      <BrowserSettingsTab />
    </QueryClientProvider>,
  );
}

describe("BrowserSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    daemon.current = { daemonId: "d1", deviceName: "pc", running: true };
    getStatus.mockResolvedValue({ state: "listening", port: 47821 });
    getEndpoint.mockResolvedValue({ url: "http://127.0.0.1:47821/mcp", token: "t1" });
    listAgents.mockResolvedValue(agents);
    listRuntimes.mockResolvedValue(runtimes);
    updateAgent.mockImplementation(async (id: string) => ag(id, id, "r1"));
    (window as unknown as { browserAPI: unknown }).browserAPI = {
      mcp: { getStatus, getEndpoint, rotateToken },
    };
  });

  it("lists only local MCP-capable agents", async () => {
    renderTab();
    expect(await screen.findByText("Claude Agent")).toBeTruthy();
    expect(screen.getByText("Other Agent")).toBeTruthy();
    expect(screen.getByText("Shared Agent")).toBeTruthy();
    expect(screen.queryByText("Remote Agent")).toBeNull();
  });

  it("shows the verified provider note", async () => {
    renderTab();
    expect(await screen.findByText("Verified: Claude Code")).toBeTruthy();
  });

  it("checking an agent merges orca-browser into its fresh mcp_config", async () => {
    getAgent.mockResolvedValue(
      ag("a1", "Claude Agent", "r1", { mcp_config: { mcpServers: { github: G } } }),
    );
    renderTab();
    const box = await screen.findByRole("checkbox", { name: "Claude Agent" });
    await waitFor(() => expect(isDisabled(box)).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(updateAgent).toHaveBeenCalledWith("a1", {
      mcp_config: { mcpServers: { github: G, "orca-browser": E } },
    });
  });

  it("unchecking removes only orca-browser", async () => {
    getAgent.mockResolvedValue(
      ag("a8", "Other Agent", "r1", {
        mcp_config: { mcpServers: { github: G, "orca-browser": E } },
      }),
    );
    renderTab();
    const box = await screen.findByRole("checkbox", { name: "Other Agent" });
    await waitFor(() => expect(isDisabled(box)).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(updateAgent).toHaveBeenCalledWith("a8", { mcp_config: { mcpServers: { github: G } } });
  });

  it("rotating the token rewrites enabled agents only", async () => {
    let copyDisabledWhileRotating = false;
    rotateToken.mockImplementation(async () => {
      await waitFor(() =>
        expect(isDisabled(screen.getByRole("button", { name: "Copy token", hidden: true }))).toBe(true),
      );
      copyDisabledWhileRotating = true;
      getEndpoint.mockResolvedValue({ url: "http://127.0.0.1:47821/mcp", token: "t2" });
      return "t2";
    });
    getAgent.mockResolvedValue(
      ag("a8", "Other Agent", "r1", {
        mcp_config: { mcpServers: { github: G, "orca-browser": E } },
      }),
    );
    renderTab();
    const rotate = await screen.findByRole("button", { name: "Rotate token" });
    await waitFor(() => expect(isDisabled(rotate)).toBe(false));
    fireEvent.click(rotate);
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Agents configured outside this page will lose access until you update them.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate token" }));
    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(rotateToken).toHaveBeenCalledTimes(1);
    expect(copyDisabledWhileRotating).toBe(true);
    const [id, body] = updateAgent.mock.calls[0]!;
    expect(id).toBe("a8");
    expect(JSON.stringify(body)).toContain("Bearer t2");
  });

  it("disables rows the viewer cannot edit", async () => {
    renderTab();
    const editable = await screen.findByRole("checkbox", { name: "Claude Agent" });
    await waitFor(() => expect(isDisabled(editable)).toBe(false));
    const box = screen.getByRole("checkbox", { name: "Shared Agent" });
    expect(isDisabled(box)).toBe(true);
    expect(
      screen.getByText("Only the agent owner or a workspace admin can change this"),
    ).toBeTruthy();
  });

  async function startRotate() {
    const rotate = await screen.findByRole("button", { name: "Rotate token" });
    await waitFor(() => expect(isDisabled(rotate)).toBe(false));
    fireEvent.click(rotate);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate token" }));
  }

  it("toasts and writes nothing when rotateToken rejects", async () => {
    rotateToken.mockRejectedValue(new Error("nope"));
    renderTab();
    await startRotate();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't rotate the token. Agents still use the previous token.",
      ),
    );
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("writes the returned token even when the endpoint refetch stays stale", async () => {
    rotateToken.mockResolvedValue("t2");
    getAgent.mockResolvedValue(
      ag("a8", "Other Agent", "r1", {
        mcp_config: { mcpServers: { github: G, "orca-browser": E } },
      }),
    );
    renderTab();
    await startRotate();
    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    const body = JSON.stringify(updateAgent.mock.calls[0]![1]);
    expect(body).toContain("Bearer t2");
    expect(body).not.toContain("Bearer t1");
  });

  it("disables checkboxes when the MCP port is in use", async () => {
    getStatus.mockResolvedValue({ state: "port_in_use", port: 47821 });
    getEndpoint.mockResolvedValue(null);
    renderTab();
    expect(
      await screen.findByText(
        "Port 47821 is already in use. Close the program using it, then restart Multica.",
      ),
    ).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox")) {
      expect(isDisabled(box)).toBe(true);
    }
    expect(isDisabled(screen.getByRole("button", { name: "Rotate token" }))).toBe(true);
  });

  it("shows the start error", async () => {
    getStatus.mockResolvedValue({ state: "error", port: 47821, message: "boom" });
    renderTab();
    expect(await screen.findByText("MCP server failed to start: boom")).toBeTruthy();
  });

  it("asks to start the daemon when there is no local daemon", async () => {
    daemon.current = { daemonId: null, deviceName: null, running: false };
    renderTab();
    expect(
      await screen.findByText("Start the local daemon to see agents on this machine"),
    ).toBeTruthy();
  });

  it("embeds the package settings panel for the current workspace", async () => {
    renderTab();
    const panel = await screen.findByTestId("browser-settings-panel");
    expect(panel.getAttribute("data-scope-id")).toBe("acme");
    const section = panel.closest("section");
    expect(section?.querySelector("h3")?.textContent).toBe("Profiles & cookies");
  });
});
