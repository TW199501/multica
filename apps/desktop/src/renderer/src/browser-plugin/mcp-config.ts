import type { BrowserMcpEndpoint } from "@elf-express/orca-browser/shared";

export const ORCA_BROWSER_MCP_KEY = "orca-browser";

const CONTAINERS = ["mcpServers", "mcp"] as const;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

export function buildOrcaBrowserMcpEntry(endpoint: BrowserMcpEndpoint): Record<string, unknown> {
  return {
    type: "http",
    url: endpoint.url,
    headers: { Authorization: `Bearer ${endpoint.token}` },
  };
}

export function hasOrcaBrowserEntry(mcpConfig: unknown): boolean {
  const doc = asObject(mcpConfig);
  if (!doc) return false;
  return CONTAINERS.some((name) => {
    const container = asObject(doc[name]);
    return !!container && ORCA_BROWSER_MCP_KEY in container;
  });
}

export function upsertOrcaBrowserEntry(
  mcpConfig: unknown,
  endpoint: BrowserMcpEndpoint,
): Record<string, unknown> {
  const doc = { ...asObject(mcpConfig) };
  const entry = buildOrcaBrowserMcpEntry(endpoint);
  // An existing entry is replaced where it lives; otherwise it goes to mcpServers.
  const target =
    CONTAINERS.find((name) => {
      const container = asObject(doc[name]);
      return !!container && ORCA_BROWSER_MCP_KEY in container;
    }) ?? "mcpServers";
  doc[target] = { ...asObject(doc[target]), [ORCA_BROWSER_MCP_KEY]: entry };
  return doc;
}

export function removeOrcaBrowserEntry(mcpConfig: unknown): Record<string, unknown> | null {
  const source = asObject(mcpConfig);
  if (!source) return null;
  const doc: Json = { ...source };
  for (const name of CONTAINERS) {
    const container = asObject(doc[name]);
    if (!container || !(ORCA_BROWSER_MCP_KEY in container)) continue;
    const { [ORCA_BROWSER_MCP_KEY]: _removed, ...rest } = container;
    if (Object.keys(rest).length === 0) delete doc[name];
    else doc[name] = rest;
  }
  return Object.keys(doc).length === 0 ? null : doc;
}
