import { providerSupportsMcpConfig } from "@multica/core/agents";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { hasOrcaBrowserEntry } from "./mcp-config";

export interface LocalBrowserAgent {
  agent: Agent;
  runtime: AgentRuntime;
  enabled: boolean;
  editable: boolean;
}

// MCP-capable providers whose daemon delivery accepts the `{ type: "http", url, headers }`
// entry as written or converts it (paths under server/):
//   claude, codebuddy: pkg/agent/claude.go:79, codebuddy.go:121 (file passed to --mcp-config)
//   codex: pkg/agent/codex.go:763 · cursor: internal/daemon/execenv/cursor_mcp.go:42
//   opencode, codearts: pkg/agent/opencode_mcp.go:316, codearts.go:759 · dsh: pkg/agent/dsh.go:181
//   ACP runtimes: pkg/agent/hermes.go:2842 · pi, omp: pkg/agent/pi.go:1261, internal/daemon/runtime_mcp.go:451
// Left out: openclaw reads `transport`, not `type` (execenv/openclaw_config.go:1361);
// qwen hands the file verbatim to Qwen Code (pkg/agent/qwen.go:94), which uses its own remote keys.
const ORCA_BROWSER_PROVIDERS = new Set([
  "claude",
  "codebuddy",
  "codex",
  "cursor",
  "opencode",
  "codearts",
  "dsh",
  "devin",
  "dim",
  "grok",
  "hermes",
  "kimi",
  "kiro",
  "mcode",
  "qoder",
  "qoderclicn",
  "qwenpaw",
  "reasonix",
  "traecli",
  "pi",
  "omp",
]);

function acceptsOrcaBrowserEntry(provider: string | undefined): boolean {
  return !!provider && providerSupportsMcpConfig(provider) && ORCA_BROWSER_PROVIDERS.has(provider);
}

export function selectLocalBrowserAgents(
  agents: Agent[],
  runtimes: AgentRuntime[],
  localDaemonId: string | null,
): LocalBrowserAgent[] {
  if (!localDaemonId) return [];
  const byId = new Map(runtimes.map((r) => [r.id, r]));
  const result: LocalBrowserAgent[] = [];
  for (const agent of agents) {
    if (agent.archived_at) continue;
    const runtime = byId.get(agent.runtime_id);
    if (!runtime) continue;
    if (runtime.daemon_id !== localDaemonId || runtime.runtime_mode !== "local") continue;
    if (!acceptsOrcaBrowserEntry(runtime.provider)) continue;
    result.push({
      agent,
      runtime,
      enabled: hasOrcaBrowserEntry(agent.mcp_config),
      editable: agent.mcp_config_redacted !== true,
    });
  }
  return result.sort((a, b) => a.agent.name.localeCompare(b.agent.name));
}
