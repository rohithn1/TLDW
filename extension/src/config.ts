/**
 * Configuration management for the TLDW Chrome extension.
 * Persists settings via chrome.storage.sync so they survive across sessions.
 */

export interface TLDWConfig {
  provider: "anthropic" | "openai" | "openrouter";
  model: string;
  apiKey: string;
}

const STORAGE_KEY = "tldw_config";

export const DEFAULT_MODEL = "google/gemini-3-flash-preview";
export const DEFAULT_PROVIDER: TLDWConfig["provider"] = "openrouter";

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-opus-4-5-20251101", "claude-sonnet-4-20250514"],
  openai: ["gpt-5", "gpt-4o"],
  openrouter: [
    "google/gemini-3-flash-preview",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-v3.2",
    "google/gemini-2.5-flash",
    "anthropic/claude-opus-4.5",
    "x-ai/grok-4.1-fast",
    "google/gemini-2.5-flash-lite",
    "openai/gpt-oss-120b",
    "google/gemini-3-pro-preview",
    "openai/gpt-5.2",
    "openai/gpt-4o-mini",
    "anthropic/claude-haiku-4.5",
    "tngtech/deepseek-r1t2-chimera:free",
    "qwen/qwen-plus-2025-07-28:thinking",
    "openai/o3-pro",
    "qwen/qwen3-next-80b-a3b-thinking",
  ],
};

export function getModelsForProvider(provider: string): string[] {
  return PROVIDER_MODELS[provider] || [];
}

export function getAllProviders(): string[] {
  return Object.keys(PROVIDER_MODELS);
}

export async function loadConfig(): Promise<TLDWConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      const config = result[STORAGE_KEY];
      if (config && config.provider && config.model && config.apiKey) {
        resolve(config as TLDWConfig);
      } else {
        resolve(null);
      }
    });
  });
}

export async function saveConfig(config: TLDWConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: config }, () => {
      resolve();
    });
  });
}

export function isConfigured(config: TLDWConfig | null): boolean {
  return config !== null && config.apiKey.length > 0;
}

/**
 * Validate a model by sending a minimal test request.
 * Returns null on success, error message on failure.
 */
export async function validateModel(
  model: string,
  provider: TLDWConfig["provider"],
  apiKey: string
): Promise<string | null> {
  try {
    if (provider === "openrouter") {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 5,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return `Model validation failed (${resp.status}): ${body}`;
      }
    } else if (provider === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "Say hello" }],
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return `Model validation failed (${resp.status}): ${body}`;
      }
    } else if (provider === "openai") {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 5,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        return `Model validation failed (${resp.status}): ${body}`;
      }
    } else {
      return `Unknown provider: ${provider}`;
    }
  } catch (err: any) {
    return `Connection error: ${err.message}`;
  }
  return null;
}
