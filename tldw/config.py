"""Configuration management for tldw."""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "tldw"
CONFIG_FILE = CONFIG_DIR / "config.json"

AVAILABLE_MODELS = [
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
    return None


def set_selected_model(model_id: str) -> None:
    config = load_config()
    config["model"] = model_id
    save_config(config)
