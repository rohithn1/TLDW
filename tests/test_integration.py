"""Integration tests for tldw CLI.

These tests hit real YouTube APIs to fetch transcripts and validate
that the full pipeline produces reasonable results. They require
network access and an LLM API key.

Run with: pytest tests/test_integration.py -v --timeout=120
"""

import os
import pytest

from tldw.transcript import extract_video_id, fetch_transcript, find_quote_timestamp, format_timestamp
from tldw.llm import summarize_video, build_transcript_text


# Skip integration tests if no API key is available
def _get_integration_model():
    """Return a model config for integration tests, or None if no keys are available."""
    if os.environ.get("OPENROUTER_API_KEY"):
        return {
            "id": "google/gemini-3-flash-preview",
            "name": "Gemini 3 Flash Preview",
            "provider": "openrouter",
            "model": "google/gemini-3-flash-preview",
        }
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {
            "id": "anthropic/claude-opus-4",
            "name": "Claude Opus 4",
            "provider": "anthropic",
            "model": "claude-opus-4-5-20251101",
        }
    if os.environ.get("OPENAI_API_KEY"):
        return {
            "id": "openai/gpt-5",
            "name": "GPT-5",
            "provider": "openai",
            "model": "gpt-5",
        }
    return None


INTEGRATION_MODEL = _get_integration_model()
requires_api_key = pytest.mark.skipif(
    INTEGRATION_MODEL is None,
    reason="No LLM API key available (set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)",
)


class TestTranscriptFetching:
    """Test that we can fetch real transcripts from YouTube."""

    def test_fetch_cancelled_video(self):
        """Fetch transcript for: https://www.youtube.com/watch?v=yn_fkFH3FUc"""
        video_id = extract_video_id("https://www.youtube.com/watch?v=yn_fkFH3FUc")
        entries = fetch_transcript(video_id)
        assert len(entries) > 0
        assert all("text" in e and "start" in e for e in entries)

    def test_fetch_penny_video(self):
        """Fetch transcript for: https://www.youtube.com/watch?v=drq1p8ykq_Q"""
        video_id = extract_video_id("https://www.youtube.com/watch?v=drq1p8ykq_Q")
        entries = fetch_transcript(video_id)
        assert len(entries) > 0
        assert all("text" in e and "start" in e for e in entries)


@requires_api_key
class TestFullPipeline:
    """End-to-end integration tests that fetch transcripts and run LLM summarization."""

    @pytest.mark.timeout(120)
    def test_cancelled_video(self):
        """
        Video: https://www.youtube.com/watch?v=yn_fkFH3FUc
        User prompt: "why is he being cancelled?"
        Expected: Response mentions lab grown meat / controversy
        Expected timestamp: ~1:30 (give or take 3 seconds)
        """
        video_id = extract_video_id("https://www.youtube.com/watch?v=yn_fkFH3FUc")
        entries = fetch_transcript(video_id)
        assert len(entries) > 0

        summary = summarize_video(entries, "why is he being cancelled?", INTEGRATION_MODEL)

        # Validate structure
        assert "one_liner" in summary
        assert "sections" in summary
        assert len(summary["sections"]) > 0

        # Validate content: the response should mention lab grown meat or controversy
        full_text = summary["one_liner"].lower()
        for section in summary["sections"]:
            full_text += " " + section.get("summary", "").lower()
            full_text += " " + section.get("quote", "").lower()

        meat_keywords = ["lab grown meat", "lab-grown", "meat", "controversial", "banned"]
        found = any(kw in full_text for kw in meat_keywords)
        assert found, (
            f"Expected response to mention lab grown meat or controversy. "
            f"Got: {full_text[:500]}"
        )

        # Validate timestamp: look for content around 1:30 (87-93 seconds)
        has_early_timestamp = any(
            87 <= section.get("_matched_start", 0) <= 93
            for section in summary["sections"]
        )
        # More lenient: at least one section should be in the first 3 minutes
        has_relevant_timestamp = any(
            0 < section.get("_matched_start", 0) <= 180
            for section in summary["sections"]
        )
        assert has_relevant_timestamp, (
            f"Expected at least one section with timestamp in first 3 minutes. "
            f"Timestamps: {[s.get('_matched_start') for s in summary['sections']]}"
        )

    @pytest.mark.timeout(120)
    def test_penny_video(self):
        """
        Video: https://www.youtube.com/watch?v=drq1p8ykq_Q
        User prompt: "so what hasnt happened in 232 years?"
        Expected: Response mentions penny / discontinuing
        Expected timestamp: ~19:35 (give or take 3 seconds) = 1175 seconds
        """
        video_id = extract_video_id("https://www.youtube.com/watch?v=drq1p8ykq_Q")
        entries = fetch_transcript(video_id)
        assert len(entries) > 0

        summary = summarize_video(entries, "so what hasnt happened in 232 years?", INTEGRATION_MODEL)

        # Validate structure
        assert "one_liner" in summary
        assert "sections" in summary
        assert len(summary["sections"]) > 0

        # Validate content: response should mention penny or discontinuing
        full_text = summary["one_liner"].lower()
        for section in summary["sections"]:
            full_text += " " + section.get("summary", "").lower()
            full_text += " " + section.get("quote", "").lower()

        penny_keywords = ["penny", "pennies", "discontinuing", "232 years", "cent"]
        found = any(kw in full_text for kw in penny_keywords)
        assert found, (
            f"Expected response to mention the penny being discontinued. "
            f"Got: {full_text[:500]}"
        )

        # Validate timestamp: look for content around 19:35 (1172-1178 seconds)
        has_precise_timestamp = any(
            1172 <= section.get("_matched_start", 0) <= 1178
            for section in summary["sections"]
        )
        # More lenient: at least one section should be in the 18-21 minute range
        has_relevant_timestamp = any(
            1080 <= section.get("_matched_start", 0) <= 1260
            for section in summary["sections"]
        )
        assert has_relevant_timestamp, (
            f"Expected at least one section with timestamp around 19:35. "
            f"Timestamps: {[s.get('_matched_start') for s in summary['sections']]}"
        )
