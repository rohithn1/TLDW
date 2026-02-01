"""YouTube transcript fetching and management."""

import json
import re
import tempfile
from pathlib import Path

from youtube_transcript_api import YouTubeTranscriptApi


def extract_video_id(url: str) -> str:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:embed/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract video ID from: {url}")


def fetch_transcript(video_id: str) -> list[dict]:
    """Fetch English transcript for a YouTube video.

    Returns list of dicts with keys: text, start, duration
    """
    api = YouTubeTranscriptApi()
    transcript = api.fetch(video_id, languages=["en"])
    entries = []
    for snippet in transcript:
        entries.append({
            "text": snippet.text,
            "start": snippet.start,
            "duration": snippet.duration,
        })
    return entries


def save_transcript(entries: list[dict], video_id: str) -> Path:
    """Save transcript to a temporary file on disk. Returns the file path."""
    tmp_dir = Path(tempfile.gettempdir()) / "tldw"
    tmp_dir.mkdir(exist_ok=True)
    filepath = tmp_dir / f"{video_id}_transcript.json"
    with open(filepath, "w") as f:
        json.dump(entries, f, indent=2)
    return filepath


def format_timestamp(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    total = int(seconds)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def seconds_to_url_param(seconds: float) -> int:
    """Convert seconds to integer for YouTube URL timestamp."""
    return int(seconds)


def make_timestamp_url(video_id: str, seconds: float) -> str:
    """Generate a YouTube URL that links to a specific timestamp."""
    t = seconds_to_url_param(seconds)
    return f"https://www.youtube.com/watch?v={video_id}&t={t}s"


def find_quote_timestamp(quote: str, entries: list[dict], threshold: float = 0.5) -> dict | None:
    """Find the best matching transcript entry for a given quote.

    Uses simple substring matching and word overlap to find the closest match.
    Returns the entry dict with start timestamp, or None if no good match found.
    """
    quote_lower = quote.lower().strip()
    quote_words = set(quote_lower.split())

    best_match = None
    best_score = 0.0

    # Build combined text windows (consecutive entries)
    for i in range(len(entries)):
        # Try windows of 1, 2, 3, and 4 consecutive entries
        for window_size in range(1, min(5, len(entries) - i + 1)):
            window_entries = entries[i:i + window_size]
            combined_text = " ".join(e["text"] for e in window_entries).lower()
            combined_words = set(combined_text.split())

            # Check direct substring containment
            if quote_lower in combined_text:
                return window_entries[0]

            # Word overlap score
            if not quote_words:
                continue
            overlap = len(quote_words & combined_words) / len(quote_words)

            if overlap > best_score:
                best_score = overlap
                best_match = window_entries[0]

    if best_score >= threshold:
        return best_match
    return None
