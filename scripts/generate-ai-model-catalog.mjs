#!/usr/bin/env node
// Regenerates the AI settings model catalog from models.dev (MIT):
//   node scripts/generate-ai-model-catalog.mjs
// The app bundles this snapshot so the settings page never calls a third party.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = "https://models.dev/api.json";
const OUTPUT = fileURLToPath(
  new URL("../packages/views/agents/ai-settings/model-catalog.json", import.meta.url),
);

// Our provider keys (provider-presets.ts) to models.dev provider ids.
const PROVIDERS = {
  claude: "anthropic",
  openai: "openai",
  gemini: "google",
  deepseek: "deepseek",
  qwen: "alibaba",
  kimi: "moonshotai",
  grok: "xai",
  openrouter: "openrouter",
  huggingface: "huggingface",
};

const TYPES = { chat: "chat", embedding: "embedding", reranking: "rerank" };

function bareName(id) {
  return id.slice(id.lastIndexOf("/") + 1).toLowerCase();
}

function toEntry(model) {
  const entry = {};
  if (model.type) entry.type = TYPES[model.type] ?? "other";
  if (model.limit?.context) entry.context = model.limit.context;
  if (model.limit?.output) entry.output = model.limit.output;
  if (model.modalities?.input?.includes("image")) entry.vision = true;
  return entry;
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`);
const data = await response.json();

const wanted = new Set(Object.values(PROVIDERS));
const models = {};
const add = (id, model) => {
  const key = bareName(id);
  // The same model is listed by many hosts; keep the first answer per field.
  models[key] = { ...toEntry(model), ...models[key] };
};

for (const [providerId, provider] of Object.entries(data)) {
  for (const [id, model] of Object.entries(provider.models ?? {})) {
    if (wanted.has(providerId) || model.type === "embedding" || model.type === "reranking") {
      add(id, model);
    }
  }
}

const providers = {};
for (const [key, providerId] of Object.entries(PROVIDERS)) {
  providers[key] = Object.entries(data[providerId]?.models ?? {})
    .filter(([, model]) => !model.type || model.type === "chat")
    .filter(([, model]) => model.status !== "deprecated")
    .map(([id]) => id)
    .sort();
}

const sorted = Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUTPUT, `${JSON.stringify({ models: sorted, providers })}\n`);
console.log(`${Object.keys(sorted).length} models written to ${OUTPUT}`);
