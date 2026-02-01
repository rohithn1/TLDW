/**
 * Options page logic for the TLDW Chrome extension.
 */

import { loadConfig, saveConfig, TLDWConfig, getModelsForProvider } from "./config.js";

const providerSelect = document.getElementById("providerSelect") as HTMLSelectElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const savedMsg = document.getElementById("savedMsg") as HTMLSpanElement;
const statusItems = document.getElementById("statusItems") as HTMLDivElement;

/**
 * Update the model dropdown based on the selected provider.
 */
function updateModelOptions(provider: string, currentModel?: string) {
  const models = getModelsForProvider(provider);
  modelSelect.innerHTML = "";
  for (const model of models) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    modelSelect.appendChild(opt);
  }
  if (currentModel && models.includes(currentModel)) {
    modelSelect.value = currentModel;
  }
}

/**
 * Update the status display.
 */
function updateStatus(config: TLDWConfig | null) {
  statusItems.innerHTML = "";

  const items: { label: string; ok: boolean; detail: string }[] = [];

  if (config) {
    items.push({
      label: "Provider",
      ok: true,
      detail: config.provider === "anthropic" ? "Anthropic (Claude)" : "OpenAI (GPT)",
    });
    items.push({
      label: "Model",
      ok: true,
      detail: config.model,
    });
    items.push({
      label: "API Key",
      ok: config.apiKey.length > 0,
      detail: config.apiKey.length > 0 ? `${config.apiKey.substring(0, 8)}...` : "Not set",
    });
  } else {
    items.push({
      label: "Configuration",
      ok: false,
      detail: "Not configured yet",
    });
  }

  for (const item of items) {
    const el = document.createElement("div");
    el.className = "status-item";

    const dot = document.createElement("div");
    dot.className = `status-dot ${item.ok ? "ok" : "err"}`;
    el.appendChild(dot);

    const text = document.createElement("span");
    text.textContent = `${item.label}: ${item.detail}`;
    el.appendChild(text);

    statusItems.appendChild(el);
  }
}

/**
 * Initialize the options page.
 */
async function init() {
  const config = await loadConfig();

  if (config) {
    providerSelect.value = config.provider;
    updateModelOptions(config.provider, config.model);
    apiKeyInput.value = config.apiKey;
  } else {
    updateModelOptions("anthropic");
  }

  updateStatus(config);

  // Provider change updates model list
  providerSelect.addEventListener("change", () => {
    updateModelOptions(providerSelect.value);
  });

  // Save button
  saveBtn.addEventListener("click", async () => {
    const newConfig: TLDWConfig = {
      provider: providerSelect.value as "anthropic" | "openai",
      model: modelSelect.value,
      apiKey: apiKeyInput.value.trim(),
    };

    await saveConfig(newConfig);
    updateStatus(newConfig);

    savedMsg.classList.add("visible");
    setTimeout(() => savedMsg.classList.remove("visible"), 2000);
  });
}

init();
