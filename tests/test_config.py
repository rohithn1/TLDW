"""Unit tests for tldw.config module."""

import json
import pytest
from pathlib import Path
from unittest.mock import patch

from tldw.config import (
    AVAILABLE_MODELS,
    DEFAULT_MODEL_ID,
    load_config,
    save_config,
    get_selected_model,
    set_selected_model,
    set_custom_model,
)


class TestAvailableModels:
    def test_has_anthropic_direct(self):
        ids = [m["id"] for m in AVAILABLE_MODELS]
        assert "anthropic/claude-opus-4" in ids

    def test_has_openai_direct(self):
        ids = [m["id"] for m in AVAILABLE_MODELS]
        assert "openai/gpt-5" in ids

    def test_has_openrouter_models(self):
        openrouter = [m for m in AVAILABLE_MODELS if m["provider"] == "openrouter"]
        assert len(openrouter) >= 16

    def test_default_model_exists(self):
        ids = [m["id"] for m in AVAILABLE_MODELS]
        assert DEFAULT_MODEL_ID in ids

    def test_all_models_have_required_fields(self):
        for m in AVAILABLE_MODELS:
            assert "id" in m
            assert "name" in m
            assert "provider" in m
            assert "model" in m

    def test_providers_are_valid(self):
        valid = {"anthropic", "openai", "openrouter"}
        for m in AVAILABLE_MODELS:
            assert m["provider"] in valid, f"Invalid provider: {m['provider']} for {m['id']}"


class TestConfigPersistence:
    @pytest.fixture
    def tmp_config(self, tmp_path):
        config_file = tmp_path / "config.json"
        with patch("tldw.config.CONFIG_FILE", config_file), \
             patch("tldw.config.CONFIG_DIR", tmp_path):
            yield config_file

    def test_load_empty(self, tmp_config):
        assert load_config() == {}

    def test_save_and_load(self, tmp_config):
        save_config({"model": "openai/gpt-5"})
        assert load_config() == {"model": "openai/gpt-5"}

    def test_get_selected_model_none(self, tmp_config):
        assert get_selected_model() is None

    def test_set_and_get_model(self, tmp_config):
        set_selected_model("openai/gpt-5")
        model = get_selected_model()
        assert model is not None
        assert model["id"] == "openai/gpt-5"
        assert model["provider"] == "openai"

    def test_set_openrouter_model(self, tmp_config):
        set_selected_model("google/gemini-3-flash-preview")
        model = get_selected_model()
        assert model is not None
        assert model["provider"] == "openrouter"

    def test_custom_model(self, tmp_config):
        set_custom_model("my-org/my-model", "openrouter")
        model = get_selected_model()
        assert model is not None
        assert model["id"] == "my-org/my-model"
        assert model["provider"] == "openrouter"

    def test_unknown_model_returns_none(self, tmp_config):
        save_config({"model": "nonexistent/model"})
        assert get_selected_model() is None
