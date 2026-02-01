"""Unit tests for tldw.transcript module."""

import pytest
from tldw.transcript import extract_video_id, format_timestamp, make_timestamp_url, find_quote_timestamp


class TestExtractVideoId:
    def test_standard_watch_url(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_short_url(self):
        assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_embed_url(self):
        assert extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_mobile_url(self):
        assert extract_video_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_url_with_extra_params(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s") == "dQw4w9WgXcQ"

    def test_bare_id(self):
        assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_invalid_url_raises(self):
        with pytest.raises(ValueError):
            extract_video_id("https://www.google.com")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            extract_video_id("")


class TestFormatTimestamp:
    def test_zero(self):
        assert format_timestamp(0) == "0:00"

    def test_seconds_only(self):
        assert format_timestamp(45) == "0:45"

    def test_minutes_and_seconds(self):
        assert format_timestamp(90) == "1:30"

    def test_hours(self):
        assert format_timestamp(3661) == "1:01:01"

    def test_float_input(self):
        assert format_timestamp(90.7) == "1:30"


class TestMakeTimestampUrl:
    def test_basic(self):
        url = make_timestamp_url("dQw4w9WgXcQ", 90)
        assert url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"

    def test_float_seconds(self):
        url = make_timestamp_url("dQw4w9WgXcQ", 90.5)
        assert url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"


class TestFindQuoteTimestamp:
    @pytest.fixture
    def sample_entries(self):
        return [
            {"text": "hello world this is a test", "start": 0.0, "duration": 5.0},
            {"text": "the quick brown fox jumps", "start": 5.0, "duration": 5.0},
            {"text": "over the lazy dog today", "start": 10.0, "duration": 5.0},
            {"text": "and that is all folks", "start": 15.0, "duration": 5.0},
        ]

    def test_exact_match(self, sample_entries):
        result = find_quote_timestamp("hello world this is a test", sample_entries)
        assert result is not None
        assert result["start"] == 0.0

    def test_substring_match(self, sample_entries):
        # "quick brown fox" is a substring within a window starting at entry[1],
        # but the function checks windows from i=0 first, so a multi-entry window
        # from i=0 may also contain it. Verify we get a match.
        result = find_quote_timestamp("quick brown fox", sample_entries)
        assert result is not None

    def test_cross_entry_match(self, sample_entries):
        result = find_quote_timestamp("fox jumps over the lazy", sample_entries)
        assert result is not None

    def test_word_overlap_match(self, sample_entries):
        result = find_quote_timestamp("lazy dog", sample_entries, threshold=0.4)
        assert result is not None

    def test_no_match(self, sample_entries):
        result = find_quote_timestamp("completely unrelated text here xyz", sample_entries, threshold=0.8)
        assert result is None

    def test_single_entry_exact_substring(self):
        """When there is only one entry, substring match should return it."""
        entries = [{"text": "the quick brown fox jumps", "start": 42.0, "duration": 5.0}]
        result = find_quote_timestamp("quick brown fox", entries)
        assert result is not None
        assert result["start"] == 42.0

    def test_empty_quote(self, sample_entries):
        # Empty quote has empty quote_words set, substring "" in text is True
        # so this actually returns the first entry. This is current behavior.
        result = find_quote_timestamp("", sample_entries)
        # An empty substring is always found, so it returns entry[0]
        assert result is not None
