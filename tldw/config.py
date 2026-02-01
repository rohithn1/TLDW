"""Configuration management for tldw."""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "tldw"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_MODEL_ID = "google/gemini-3-flash-preview"

AVAILABLE_MODELS = [
    # --- Direct providers ---
    {
        "id": "anthropic/claude-opus-4",
        "name": "Claude Opus 4 (Anthropic)",
        "provider": "anthropic",
        "model": "claude-opus-4-5-20251101",
    },
    {
        "id": "openai/gpt-5",
        "name": "GPT-5 (OpenAI)",
        "provider": "openai",
        "model": "gpt-5",
    },
    # --- OpenRouter models ---
    {
        "id": "google/gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview (OpenRouter)",
        "provider": "openrouter",
        "model": "google/gemini-3-flash-preview",
    },
    {
        "id": "anthropic/claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5 (OpenRouter)",
        "provider": "openrouter",
        "model": "anthropic/claude-sonnet-4.5",
    },
    {
        "id": "deepseek/deepseek-v3.2",
        "name": "DeepSeek V3.2 (OpenRouter)",
        "provider": "openrouter",
        "model": "deepseek/deepseek-v3.2",
    },
    {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash (OpenRouter)",
        "provider": "openrouter",
        "model": "google/gemini-2.5-flash",
    },
    {
        "id": "anthropic/claude-opus-4.5",
        "name": "Claude Opus 4.5 (OpenRouter)",
        "provider": "openrouter",
        "model": "anthropic/claude-opus-4.5",
    },
    {
        "id": "x-ai/grok-4.1-fast",
        "name": "Grok 4.1 Fast (OpenRouter)",
        "provider": "openrouter",
        "model": "x-ai/grok-4.1-fast",
    },
    {
        "id": "google/gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash Lite (OpenRouter)",
        "provider": "openrouter",
        "model": "google/gemini-2.5-flash-lite",
    },
    {
        "id": "openai/gpt-oss-120b",
        "name": "gpt-oss-120b (OpenRouter)",
        "provider": "openrouter",
        "model": "openai/gpt-oss-120b",
    },
    {
        "id": "google/gemini-3-pro-preview",
        "name": "Gemini 3 Pro Preview (OpenRouter)",
        "provider": "openrouter",
        "model": "google/gemini-3-pro-preview",
    },
    {
        "id": "openai/gpt-5.2",
        "name": "GPT-5.2 (OpenRouter)",
        "provider": "openrouter",
        "model": "openai/gpt-5.2",
    },
    {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o-mini (OpenRouter)",
        "provider": "openrouter",
        "model": "openai/gpt-4o-mini",
    },
    {
        "id": "anthropic/claude-haiku-4.5",
        "name": "Claude Haiku 4.5 (OpenRouter)",
        "provider": "openrouter",
        "model": "anthropic/claude-haiku-4.5",
    },
    {
        "id": "tngtech/deepseek-r1t2-chimera:free",
        "name": "DeepSeek R1T2 Chimera - free (OpenRouter)",
        "provider": "openrouter",
        "model": "tngtech/deepseek-r1t2-chimera:free",
    },
    {
        "id": "qwen/qwen-plus-2025-07-28:thinking",
        "name": "Qwen Plus 0728 thinking (OpenRouter)",
        "provider": "openrouter",
        "model": "qwen/qwen-plus-2025-07-28:thinking",
    },
    {
        "id": "openai/o3-pro",
        "name": "o3 Pro (OpenRouter)",
        "provider": "openrouter",
        "model": "openai/o3-pro",
    },
    {
        "id": "qwen/qwen3-next-80b-a3b-thinking",
        "name": "Qwen3 Next 80B A3B Thinking (OpenRouter)",
        "provider": "openrouter",
        "model": "qwen/qwen3-next-80b-a3b-thinking",
    },
]


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def save_config(config: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def get_selected_model() -> dict | None:
    config = load_config()
    model_id = config.get("model")
    if model_id:
        for m in AVAILABLE_MODELS:
            if m["id"] == model_id:
                return m
        # Support custom models stored in config
        custom = config.get("custom_model")
        if custom and custom.get("id") == model_id:
            return custom
    return None


def set_selected_model(model_id: str) -> None:
    config = load_config()
    config["model"] = model_id
    save_config(config)


def set_custom_model(model_id: str, provider: str) -> None:
    """Store a custom model in config."""
    config = load_config()
    config["model"] = model_id
    config["custom_model"] = {
        "id": model_id,
        "name": f"{model_id} (custom)",
        "provider": provider,
        "model": model_id,
    }
    save_config(config)


def validate_model(model_id: str, provider: str) -> str | None:
    """Validate a model by sending a test request. Returns None on success, error message on failure."""
    if provider == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            return "OPENROUTER_API_KEY environment variable is required"
        import httpx
        try:
            resp = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": "Say hello"}],
                    "max_tokens": 5,
                },
                timeout=30,
            )
            if resp.status_code != 200:
                body = resp.text
                return f"Model validation failed ({resp.status_code}): {body}"
        except Exception as e:
            return f"Connection error: {e}"
    elif provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return "ANTHROPIC_API_KEY environment variable is required"
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            client.messages.create(
                model=model_id,
                max_tokens=5,
                messages=[{"role": "user", "content": "Say hello"}],
            )
        except Exception as e:
            return f"Model validation failed: {e}"
    elif provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return "OPENAI_API_KEY environment variable is required"
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": "Say hello"}],
                max_tokens=5,
            )
        except Exception as e:
            return f"Model validation failed: {e}"
    else:
        return f"Unknown provider: {provider}"
    return None
