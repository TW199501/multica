"use client";

import { useQuery } from "@tanstack/react-query";

export type ModelType = "chat" | "embedding" | "rerank" | "decision" | "other";

export interface ModelCatalogEntry {
  type?: string;
  context?: number;
  output?: number;
  vision?: boolean;
}

/** A snapshot of models.dev; `scripts/generate-ai-model-catalog.mjs` writes it. */
export interface ModelCatalog {
  /** Keyed by the lower-case model name without its host or vendor path. */
  models: Record<string, ModelCatalogEntry>;
  /** Selectable model ids per provider preset key. */
  providers: Record<string, string[]>;
}

const KNOWN_TYPES = new Set<string>(["chat", "embedding", "rerank", "decision", "other"]);

function bareName(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function lookupModel(
  id: string,
  catalog: ModelCatalog | null,
): ModelCatalogEntry | undefined {
  return catalog?.models[bareName(id)];
}

/**
 * What a model is for. People cannot be expected to know, so nothing asks them:
 * the catalog answers first, then the model's name, and anything else is a chat
 * model. Only the name is read, because a host in the path (openrouter/…) says
 * nothing about the model.
 */
export function detectModelType(
  id: string,
  catalog: ModelCatalog | null,
): ModelType | null {
  const name = bareName(id);
  if (!name) return null;
  const listed = lookupModel(id, catalog)?.type;
  if (listed && KNOWN_TYPES.has(listed)) return listed as ModelType;
  if (name.includes("embed")) return "embedding";
  if (name.includes("rerank")) return "rerank";
  if (/(^|[-_.])(decide|decider|decision|router)([-_.]|$)/.test(name)) return "decision";
  if (/whisper|transcri|speech|(^|[-_.])(tts|asr)([-_.]|$)/.test(name)) return "other";
  return "chat";
}

export function catalogModelsFor(
  providerKey: string,
  catalog: ModelCatalog | null,
): string[] {
  return catalog?.providers[providerKey] ?? [];
}

/** Loads the snapshot only on this page; null until it arrives. */
export function useModelCatalog(): ModelCatalog | null {
  const { data } = useQuery({
    queryKey: ["ai-settings", "model-catalog"],
    queryFn: async () => (await import("./model-catalog.json")).default as ModelCatalog,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}
