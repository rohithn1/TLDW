"""Unit tests for tldw.llm module."""

import json
import pytest

from tldw.llm import (
    build_transcript_text,
    build_prompt,
    parse_llm_response,
    _get_max_transcript_chars,
    _chunk_entries,
)


class TestBuildTranscriptText:
    def test_basic(self):
        entries = [
            {"text": "hello world", "start": 0.0, "duration": 5.0},
            {"text": "second line", "start": 65.0, "duration": 5.0},
        ]
        result = build_transcript_text(entries)
        assert "[0:00] hello world" in result
        assert "[1:05] second line" in result

    def test_empty(self):
        assert build_transcript_text([]) == ""


class TestBuildPrompt:
    def test_general_prompt(self):
        result = build_prompt("transcript text here", None)
        assert "transcript text here" in result
        assert "general summary" in result.lower()

    def test_specific_prompt(self):
        result = build_prompt("transcript text here", "what happened?")
        assert "transcript text here" in result
        assert "what happened?" in result


class TestParseLlmResponse:
    def test_plain_json(self):
        data = {"one_liner": "test", "sections": []}
        result = parse_llm_response(json.dumps(data))
        assert result["one_liner"] == "test"

    def test_json_with_code_fence(self):
        data = {"one_liner": "test", "sections": []}
        raw = f"```json\n{json.dumps(data)}\n```"
        result = parse_llm_response(raw)
        assert result["one_liner"] == "test"

    def test_json_with_plain_fence(self):
        data = {"one_liner": "test", "sections": []}
        raw = f"```\n{json.dumps(data)}\n```"
        result = parse_llm_response(raw)
        assert result["one_liner"] == "test"

    def test_invalid_json_raises(self):
        with pytest.raises(json.JSONDecodeError):
            parse_llm_response("not json at all")


class TestGetMaxTranscriptChars:
    def test_known_model(self):
        config = {"model": "claude-opus-4-5-20251101"}
        chars = _get_max_transcript_chars(config)
        # (200000 - 6000) * 4 = 776000
        assert chars == 776000

    def test_unknown_model_uses_default(self):
        config = {"model": "some-unknown-model"}
        chars = _get_max_transcript_chars(config)
        # (128000 - 6000) * 4 = 488000
        assert chars == 488000


class TestChunkEntries:
    def test_single_chunk(self):
        entries = [{"text": "hello", "start": 0.0}]
        chunks = _chunk_entries(entries, 1000)
        assert len(chunks) == 1

    def test_multiple_chunks(self):
        entries = [
            {"text": "word " * 100, "start": float(i)}
            for i in range(100)
        ]
        chunks = _chunk_entries(entries, 500)
        assert len(chunks) > 1

    def test_all_entries_preserved(self):
        entries = [
            {"text": f"entry {i}", "start": float(i)}
            for i in range(10)
        ]
        chunks = _chunk_entries(entries, 50)
        all_entries = [e for chunk in chunks for e in chunk]
        assert len(all_entries) == 10
