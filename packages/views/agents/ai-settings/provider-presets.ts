export interface ProviderPreset {
  /** Provider id; the server accepts exactly these values. */
  key: string;
  /** OpenAI-compatible endpoint filled in when the provider is picked. */
  baseUrl: string;
  /** Suggested models; the model field still accepts any typed value. */
  models: string[];
}

// Endpoints and model ids come from each vendor's OpenAI-compatibility docs
// (checked 2026-11-03). Model ids drift quickly, which is why the model field
// stays free-form.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "claude",
    baseUrl: "https://api.anthropic.com/v1/",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
  },
  {
    key: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.1-sol"],
  },
  {
    key: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    models: ["gemini-3.8-flash"],
  },
  {
    key: "deepseek",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    key: "qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen3.8-max", "qwen3.7-plus"],
  },
  {
    key: "kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    models: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"],
  },
  {
    key: "grok",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4.7", "grok-4.6"],
  },
  {
    key: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["~anthropic/claude-sonnet-latest", "~openai/gpt-sol-latest"],
  },
  {
    key: "huggingface",
    baseUrl: "https://router.huggingface.co/v1",
    models: ["openai/gpt-oss-120b", "deepseek-ai/DeepSeek-R1"],
  },
  {
    key: "llamacpp",
    baseUrl: "http://localhost:8080/v1",
    models: [],
  },
  { key: "custom", baseUrl: "", models: [] },
];

/** Providers whose endpoint may run without an API key, so the key is never forced. */
export const KEYLESS_PROVIDERS = new Set(["llamacpp", "custom"]);
