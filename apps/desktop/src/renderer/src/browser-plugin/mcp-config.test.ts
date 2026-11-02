// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildOrcaBrowserMcpEntry,
  hasOrcaBrowserEntry,
  removeOrcaBrowserEntry,
  upsertOrcaBrowserEntry,
} from "./mcp-config";

const endpoint = { url: "http://127.0.0.1:47821/mcp", token: "ab" };
const E = buildOrcaBrowserMcpEntry(endpoint);
const G = { command: "gh" };

describe("orca-browser mcp_config helpers", () => {
  it("builds the http entry", () => {
    expect(E).toEqual({
      type: "http",
      url: "http://127.0.0.1:47821/mcp",
      headers: { Authorization: "Bearer ab" },
    });
  });

  it("creates mcpServers when config is empty", () => {
    expect(upsertOrcaBrowserEntry(null, endpoint)).toEqual({
      mcpServers: { "orca-browser": E },
    });
  });

  it("keeps other servers and top-level fields", () => {
    const input = { mcpServers: { github: G }, extra: 1 };
    const before = structuredClone(input);
    expect(upsertOrcaBrowserEntry(input, endpoint)).toEqual({
      mcpServers: { github: G, "orca-browser": E },
      extra: 1,
    });
    expect(input).toEqual(before);
  });

  it("replaces an entry that lives under mcp in place", () => {
    const result = upsertOrcaBrowserEntry({ mcp: { "orca-browser": { url: "old" } } }, endpoint);
    expect(result).toEqual({ mcp: { "orca-browser": E } });
    expect(result).not.toHaveProperty("mcpServers");
  });

  it("removes only orca-browser", () => {
    expect(removeOrcaBrowserEntry({ mcpServers: { github: G, "orca-browser": E } })).toEqual({
      mcpServers: { github: G },
    });
    expect(removeOrcaBrowserEntry({ mcpServers: { "orca-browser": E } })).toBeNull();
    expect(removeOrcaBrowserEntry({ mcpServers: { "orca-browser": E }, other: 1 })).toEqual({
      other: 1,
    });
  });

  it("detects the entry in either container", () => {
    expect(hasOrcaBrowserEntry({ mcpServers: { "orca-browser": E } })).toBe(true);
    expect(hasOrcaBrowserEntry({ mcp: { "orca-browser": E } })).toBe(true);
    expect(hasOrcaBrowserEntry(null)).toBe(false);
    expect(hasOrcaBrowserEntry([])).toBe(false);
    expect(hasOrcaBrowserEntry("x")).toBe(false);
  });
});
