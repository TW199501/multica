import { providerSupportsMcpConfig } from "@multica/core/agents";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { hasOrcaBrowserEntry } from "./mcp-config";

export interface LocalBrowserAgent {
  agent: Agent;
  runtime: AgentRuntime;
  enabled: boolean;
  editable: boolean;
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
    if (!providerSupportsMcpConfig(runtime.provider)) continue;
    result.push({
      agent,
      runtime,
      enabled: hasOrcaBrowserEntry(agent.mcp_config),
      editable: agent.mcp_config_redacted !== true,
    });
  }
  return result.sort((a, b) => a.agent.name.localeCompare(b.agent.name));
}
