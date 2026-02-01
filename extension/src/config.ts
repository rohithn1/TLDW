/**
 * Configuration management for the TLDW Chrome extension.
 * Persists settings via chrome.storage.sync so they survive across sessions.
 */

export interface TLDWConfig {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
}

const STORAGE_KEY = "tldw_config";

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-opus-4-5-20251101", "claude-sonnet-4-20250514"],
  openai: ["gpt-5", "gpt-4o"],
};

export function getModelsForProvider(provider: string): string[] {
  return PROVIDER_MODELS[provider] || [];
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
