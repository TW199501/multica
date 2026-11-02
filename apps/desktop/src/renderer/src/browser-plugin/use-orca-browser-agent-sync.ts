import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { BrowserMcpEndpoint } from "@elf-express/orca-browser/shared";
import { api } from "@multica/core/api";
import type { Agent } from "@multica/core/types";
import { agentDetailOptions, cacheAgentResponse, workspaceKeys } from "@multica/core/workspace/queries";
import { removeOrcaBrowserEntry, upsertOrcaBrowserEntry } from "./mcp-config";

export const browserMcpStatusKey = ["desktop", "orca-browser", "mcp-status"] as const;
export const browserMcpEndpointKey = ["desktop", "orca-browser", "mcp-endpoint"] as const;

export interface OrcaBrowserSyncVars {
  agentId: string;
  /** `null` removes the orca-browser entry. */
  endpoint: BrowserMcpEndpoint | null;
}

export function useOrcaBrowserAgentSync(
  wsId: string,
): UseMutationResult<Agent, Error, OrcaBrowserSyncVars> {
  const qc = useQueryClient();
  return useMutation<Agent, Error, OrcaBrowserSyncVars>({
    mutationFn: async ({ agentId, endpoint }) => {
      // List responses can be stale or redacted; merge into the live config.
      const fresh = await qc.fetchQuery({ ...agentDetailOptions(wsId, agentId), staleTime: 0 });
      if (fresh.mcp_config_redacted === true) throw new Error("mcp_config_redacted");
      const next = endpoint
        ? upsertOrcaBrowserEntry(fresh.mcp_config, endpoint)
        : removeOrcaBrowserEntry(fresh.mcp_config);
      return api.updateAgent(agentId, { mcp_config: next });
    },
    onSuccess: (agent) => {
      cacheAgentResponse(qc, wsId, agent, { insertIntoList: false });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
    },
  });
}

/** Rewrites agents one by one so a single failure does not stop the rest. */
export async function rewriteEnabledAgents(
  agentIds: string[],
  endpoint: BrowserMcpEndpoint,
  write: (v: { agentId: string; endpoint: BrowserMcpEndpoint }) => Promise<Agent>,
): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const agentId of agentIds) {
    try {
      await write({ agentId, endpoint });
    } catch {
      failed.push(agentId);
    }
  }
  return { failed };
}
