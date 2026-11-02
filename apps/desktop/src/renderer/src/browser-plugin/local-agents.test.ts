// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { selectLocalBrowserAgents } from "./local-agents";

const rt = (id: string, over: Partial<AgentRuntime> = {}) =>
  ({ id, daemon_id: "d1", runtime_mode: "local", provider: "claude", ...over }) as AgentRuntime;
const ag = (id: string, runtimeId: string, over: Partial<Agent> = {}) =>
  ({ id, name: id, runtime_id: runtimeId, archived_at: null, mcp_config: null, ...over }) as Agent;

describe("selectLocalBrowserAgents", () => {
  it("returns nothing without a local daemon", () => {
    expect(selectLocalBrowserAgents([ag("a1", "r1")], [rt("r1")], null)).toEqual([]);
  });

  it("keeps only MCP-capable agents on the local daemon", () => {
    const runtimes = [
      rt("r1"),
      rt("r2", { daemon_id: "d2" }),
      rt("r3", { provider: "copilot" }),
      rt("r5", { runtime_mode: "cloud" }),
    ];
    const agents = [
      ag("a1", "r1"),
      ag("a2", "r2"),
      ag("a3", "r3"),
      ag("a4", "r1", { archived_at: "2026-01-01T00:00:00Z" }),
      ag("a5", "r5"),
      ag("a6", ""),
    ];
    expect(selectLocalBrowserAgents(agents, runtimes, "d1").map((x) => x.agent.id)).toEqual(["a1"]);
  });

  it("offers only providers whose daemon accepts the orca-browser HTTP entry", () => {
    const providers = ["claude", "codex", "cursor", "opencode", "hermes", "dsh", "openclaw", "qwen"];
    const runtimes = providers.map((provider) => rt(provider, { provider }));
    const agents = providers.map((provider) => ag(provider, provider));
    expect(selectLocalBrowserAgents(agents, runtimes, "d1").map((x) => x.agent.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "dsh",
      "hermes",
      "opencode",
    ]);
  });

  it("marks enabled and editable", () => {
    const agents = [
      ag("a1", "r1", { mcp_config: { mcpServers: { "orca-browser": {} } } }),
      ag("a7", "r1", { mcp_config_redacted: true }),
    ];
    const result = selectLocalBrowserAgents(agents, [rt("r1")], "d1");
    expect(result[0]).toMatchObject({ enabled: true, editable: true });
    expect(result[1]).toMatchObject({ enabled: false, editable: false });
  });

  it("sorts by agent name", () => {
    const agents = [ag("x", "r1", { name: "b" }), ag("y", "r1", { name: "A" })];
    const result = selectLocalBrowserAgents(agents, [rt("r1")], "d1");
    expect(result.map((x) => x.agent.name)).toEqual(["A", "b"]);
  });
});
