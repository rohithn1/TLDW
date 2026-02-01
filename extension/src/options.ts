/**
 * Options page logic for the TLDW Chrome extension.
 */

import {
  loadConfig,
  saveConfig,
  TLDWConfig,
  getModelsForProvider,
  validateModel,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from "./config.js";

const providerSelect = document.getElementById("providerSelect") as HTMLSelectElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const customModelToggle = document.getElementById("customModelToggle") as HTMLInputElement;
const customModelSection = document.getElementById("customModelSection") as HTMLDivElement;
const customModelInput = document.getElementById("customModelInput") as HTMLInputElement;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const apiKeyHint = document.getElementById("apiKeyHint") as HTMLDivElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const savedMsg = document.getElementById("savedMsg") as HTMLSpanElement;
const errorMsgEl = document.getElementById("errorMsg") as HTMLSpanElement;
const validatingMsg = document.getElementById("validatingMsg") as HTMLSpanElement;
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
  } else if (models.length > 0) {
    modelSelect.value = models[0];
  }
}

/**
 * Update API key hint based on provider.
 */
function updateApiKeyHint(provider: string) {
  const hints: Record<string, string> = {
    openrouter: "Your OpenRouter API key. Get one at openrouter.ai/keys",
    anthropic: "Your Anthropic API key. Get one at console.anthropic.com",
    openai: "Your OpenAI API key. Get one at platform.openai.com",
  };
  apiKeyHint.textContent = hints[provider] || "Your API key is stored locally.";
}

function showError(msg: string) {
  errorMsgEl.textContent = msg;
  errorMsgEl.classList.add("visible");
  savedMsg.classList.remove("visible");
  validatingMsg.classList.remove("visible");
}

function clearMessages() {
  errorMsgEl.classList.remove("visible");
  savedMsg.classList.remove("visible");
  validatingMsg.classList.remove("visible");
}

/**
 * Update the status display.
 */
function updateStatus(config: TLDWConfig | null) {
  statusItems.innerHTML = "";

  const items: { label: string; ok: boolean; detail: string }[] = [];

  if (config) {
    const providerNames: Record<string, string> = {
      openrouter: "OpenRouter",
      anthropic: "Anthropic (Claude)",
      openai: "OpenAI (GPT)",
    };
    items.push({
      label: "Provider",
      ok: true,
      detail: providerNames[config.provider] || config.provider,
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

    // Check if the model is a custom one (not in the dropdown list)
    const knownModels = getModelsForProvider(config.provider);
    if (!knownModels.includes(config.model)) {
      customModelToggle.checked = true;
      customModelSection.classList.add("visible");
      customModelInput.value = config.model;
    }
  } else {
    providerSelect.value = DEFAULT_PROVIDER;
    updateModelOptions(DEFAULT_PROVIDER);
  }

  updateApiKeyHint(providerSelect.value);
  updateStatus(config);

  // Provider change updates model list and hint
  providerSelect.addEventListener("change", () => {
    updateModelOptions(providerSelect.value);
    updateApiKeyHint(providerSelect.value);
    clearMessages();
  });

  // Custom model toggle
  customModelToggle.addEventListener("change", () => {
    if (customModelToggle.checked) {
      customModelSection.classList.add("visible");
    } else {
      customModelSection.classList.remove("visible");
    }
    clearMessages();
  });

  // Save button
  saveBtn.addEventListener("click", async () => {
    clearMessages();

    const provider = providerSelect.value as TLDWConfig["provider"];
    const apiKey = apiKeyInput.value.trim();
    let model: string;

    if (customModelToggle.checked) {
      model = customModelInput.value.trim();
      if (!model) {
        showError("Please enter a custom model ID.");
        return;
      }

      // Validate custom model
      if (!apiKey) {
        showError("API key is required to validate the custom model.");
        return;
      }

      saveBtn.disabled = true;
      validatingMsg.classList.add("visible");

      const error = await validateModel(model, provider, apiKey);
      validatingMsg.classList.remove("visible");
      saveBtn.disabled = false;

      if (error) {
        showError(`Invalid model: ${error}`);
        return;
      }
    } else {
      model = modelSelect.value;
    }

    const newConfig: TLDWConfig = { provider, model, apiKey };

    await saveConfig(newConfig);
    updateStatus(newConfig);

    savedMsg.classList.add("visible");
    setTimeout(() => savedMsg.classList.remove("visible"), 2000);
  });
}

init();
