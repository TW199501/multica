// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  catalogModelsFor,
  detectModelType,
  lookupModel,
  type ModelCatalog,
} from "./model-catalog";
import bundled from "./model-catalog.json";

const CATALOG: ModelCatalog = {
  models: {
    "qwen3-embedding-8b": { type: "embedding", context: 32000 },
    "qwen3-reranker-4b": { type: "rerank" },
    "gpt-image-x": { type: "other" },
    "vision-pro": { context: 200000, output: 8000, vision: true },
    "plain-chat": { context: 100000 },
    "named-rerank-but-chat": { type: "chat" },
  },
  providers: { openai: ["vision-pro", "plain-chat"] },
};

describe("detectModelType", () => {
  it.each([
    ["Qwen/Qwen3-Embedding-8B", "embedding"],
    ["qwen3-reranker-4b", "rerank"],
    ["gpt-image-x", "other"],
    ["named-rerank-but-chat", "chat"],
    ["vision-pro", "chat"],
  ])("trusts the catalog for %s", (id, type) => {
    expect(detectModelType(id, CATALOG)).toBe(type);
  });

  it.each([
    ["my-org/custom-embed-v2", "embedding"],
    ["BAAI/bge-RERANKER-v9", "rerank"],
    ["fastino/GLiNER-2.5-Decide", "decision"],
    ["amazon/Strands-Decider-2B", "decision"],
    ["katanemo/Arch-Router-1.5B", "decision"],
    ["whisper-large-v3", "other"],
    ["some-new-model", "chat"],
  ])("reads the name of an unlisted model: %s", (id, type) => {
    expect(detectModelType(id, CATALOG)).toBe(type);
    expect(detectModelType(id, null)).toBe(type);
  });

  it("does not take a router host in the path for a decision model", () => {
    expect(detectModelType("openrouter/auto", CATALOG)).toBe("chat");
    expect(detectModelType("router/some-chat-model", CATALOG)).toBe("chat");
  });

  it("has no type for an empty model", () => {
    expect(detectModelType("  ", CATALOG)).toBeNull();
  });
});

describe("lookupModel", () => {
  it("finds a model by its bare name, in any case", () => {
    expect(lookupModel("Qwen/QWEN3-Embedding-8B", CATALOG)?.context).toBe(32000);
  });

  it("reports vision only when the catalog says so", () => {
    expect(lookupModel("vision-pro", CATALOG)?.vision).toBe(true);
    expect(lookupModel("plain-chat", CATALOG)?.vision).toBeUndefined();
  });

  it("knows nothing without a catalog or for an unlisted model", () => {
    expect(lookupModel("vision-pro", null)).toBeUndefined();
    expect(lookupModel("unlisted", CATALOG)).toBeUndefined();
  });
});

describe("catalogModelsFor", () => {
  it("lists a provider's models", () => {
    expect(catalogModelsFor("openai", CATALOG)).toEqual(["vision-pro", "plain-chat"]);
  });

  it("is empty without a catalog or for a provider it does not cover", () => {
    expect(catalogModelsFor("openai", null)).toEqual([]);
    expect(catalogModelsFor("llamacpp", CATALOG)).toEqual([]);
  });
});

describe("bundled catalog", () => {
  const catalog = bundled as ModelCatalog;

  it("types the embedding and rerank models it carries", () => {
    expect(detectModelType("Qwen/Qwen3-Embedding-8B", catalog)).toBe("embedding");
    expect(detectModelType("baai/bge-reranker-v2-m3", catalog)).toBe("rerank");
  });

  it("covers every hosted provider preset", () => {
    for (const key of ["claude", "openai", "gemini", "deepseek", "qwen", "kimi", "grok", "openrouter", "huggingface"]) {
      expect(catalog.providers[key]?.length, key).toBeGreaterThan(0);
    }
  });

  it("marks at least some models as vision capable, and not all of them", () => {
    const entries = Object.values(catalog.models);
    const vision = entries.filter((entry) => entry.vision).length;
    expect(vision).toBeGreaterThan(0);
    expect(vision).toBeLessThan(entries.length);
  });
});
