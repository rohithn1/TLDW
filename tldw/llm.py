"""LLM integration for summarization."""

import json
import math
import os
import subprocess


# Approximate max tokens for the transcript portion of the prompt.
# Reserve ~2000 tokens for system prompt + instructions + response overhead.
# 1 token ~ 4 chars for English text.
MODEL_CONTEXT_LIMITS = {
    "claude-opus-4-5-20251101": 200000,
    "gpt-5": 128000,
}
DEFAULT_CONTEXT_LIMIT = 128000
RESERVED_TOKENS = 6000  # system prompt + formatting + response
CHARS_PER_TOKEN = 4


SYSTEM_PROMPT = """You are a super chill video summarizer. Your vibe is laid back, friendly, and conversational -- like you're telling a friend about a video you just watched. Keep it real, keep it casual.

You will be given a transcript of a YouTube video. Your job is to summarize it.

IMPORTANT RULES:
1. Return your response as valid JSON only -- no markdown, no code fences, no extra text.
2. Every quote you provide MUST be an EXACT substring from the transcript. Do not paraphrase, rearrange, or fabricate quotes. Copy them word-for-word from the transcript text provided.
3. Each section should reference a specific part of the video with an exact quote.

Return a JSON object with this exact structure:
{
  "one_liner": "A single casual phrase summarizing the whole video",
  "sections": [
    {
      "title": "Section title",
      "summary": "A chill, detailed summary of this part (2-4 sentences)",
      "quote": "exact words copied from the transcript that back up this section",
      "timestamp_hint": "rough description of when this happens"
    }
  ]
}

Keep the tone relaxed and conversational throughout. Like you're just vibing and breaking it down for a buddy."""

USER_PROMPT_TEMPLATE = """Here's the video transcript:

{transcript}

{focus_instruction}

Remember: every "quote" field MUST be an exact copy-paste from the transcript above. Do not change even a single word. Return ONLY valid JSON."""

FOCUS_GENERAL = "Give me a general summary of the whole video, breaking it into the main topics covered."
FOCUS_SPECIFIC = 'The viewer specifically wants to know: "{prompt}". Focus your summary primarily on parts of the video related to this, but also briefly cover other major topics.'

RETRY_PROMPT = """Some of your quotes were not found in the original transcript. Here are the invalid quotes:

{bad_quotes}

Please provide new exact quotes from the transcript for those sections. Remember: quotes must be EXACT substrings from the transcript -- copy them word for word.

Return the full JSON response again with corrected quotes. Return ONLY valid JSON, no markdown fences."""


def build_transcript_text(entries: list[dict]) -> str:
    """Build a single text block from transcript entries with timestamps."""
    lines = []
    for e in entries:
        minutes = int(e["start"]) // 60
        seconds = int(e["start"]) % 60
        lines.append(f"[{minutes}:{seconds:02d}] {e['text']}")
    return "\n".join(lines)


def build_prompt(transcript_text: str, user_prompt: str | None) -> str:
    if user_prompt:
        focus = FOCUS_SPECIFIC.format(prompt=user_prompt)
    else:
        focus = FOCUS_GENERAL
    return USER_PROMPT_TEMPLATE.format(transcript=transcript_text, focus_instruction=focus)


def call_llm(system: str, user_message: str, model_config: dict) -> str:
    """Call the LLM and return the raw response text."""
    provider = model_config["provider"]

    if provider == "anthropic":
        return _call_anthropic(system, user_message, model_config)
    elif provider == "openai":
        return _call_openai(system, user_message, model_config)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def _call_anthropic(system: str, user_message: str, model_config: dict) -> str:
    """Call Anthropic via the claude CLI to use existing auth."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if api_key:
        # Use the SDK directly if an API key is available
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model_config["model"],
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
        return response.content[0].text

    # Fall back to claude CLI which has existing auth
    full_prompt = f"System instructions: {system}\n\n{user_message}"
    result = subprocess.run(
        [
            "claude", "-p",
            "--model", "opus",
            "--output-format", "text",
            "--no-session-persistence",
            full_prompt,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed: {result.stderr}")
    return result.stdout.strip()


def _call_openai(system: str, user_message: str, model_config: dict) -> str:
    """Call OpenAI API."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY environment variable is required for OpenAI models. "
            "Set it with: export OPENAI_API_KEY=your-key-here"
        )
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model_config["model"],
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
        max_tokens=4096,
    )
    return response.choices[0].message.content


def parse_llm_response(raw: str) -> dict:
    """Parse the LLM JSON response, handling common formatting issues."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (fences)
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    return json.loads(text)


def _get_max_transcript_chars(model_config: dict) -> int:
    """Get the max character count for transcript text given the model's context limit."""
    model_id = model_config.get("model", "")
    context_limit = MODEL_CONTEXT_LIMITS.get(model_id, DEFAULT_CONTEXT_LIMIT)
    available_tokens = context_limit - RESERVED_TOKENS
    return available_tokens * CHARS_PER_TOKEN


def _chunk_entries(entries: list[dict], max_chars: int) -> list[list[dict]]:
    """Split transcript entries into chunks that fit within the character limit."""
    chunks = []
    current_chunk = []
    current_chars = 0

    for entry in entries:
        # Estimate the formatted line length: "[M:SS] text\n"
        line_len = len(f"[{int(entry['start']) // 60}:{int(entry['start']) % 60:02d}] {entry['text']}\n")
        if current_chars + line_len > max_chars and current_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_chars = 0
        current_chunk.append(entry)
        current_chars += line_len

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


MERGE_SYSTEM_PROMPT = """You are a super chill video summarizer. You will be given multiple partial summaries of different parts of a YouTube video. Merge them into one cohesive summary.

IMPORTANT RULES:
1. Return your response as valid JSON only -- no markdown, no code fences, no extra text.
2. Every quote you provide MUST be an EXACT substring taken directly from the partial summaries' quotes. Do not fabricate new quotes.
3. Keep the best and most relevant sections from each partial summary.
4. Deduplicate overlapping topics.

Return a JSON object with this exact structure:
{
  "one_liner": "A single casual phrase summarizing the whole video",
  "sections": [
    {
      "title": "Section title",
      "summary": "A chill, detailed summary of this part (2-4 sentences)",
      "quote": "exact words from a partial summary quote",
      "timestamp_hint": "rough description of when this happens"
    }
  ]
}

Keep the tone relaxed and conversational throughout."""


def summarize_video(
    transcript_entries: list[dict],
    user_prompt: str | None,
    model_config: dict,
    max_retries: int = 2,
) -> dict:
    """Run the full summarization pipeline with quote validation.

    If the transcript exceeds the model's context limit, it is chunked and
    each chunk is summarized separately, then merged into a final summary.

    Returns the parsed summary dict with validated quotes and timestamps.
    """
    from tldw.transcript import find_quote_timestamp

    transcript_text = build_transcript_text(transcript_entries)
    max_chars = _get_max_transcript_chars(model_config)

    # Check if chunking is needed
    if len(transcript_text) > max_chars:
        chunks = _chunk_entries(transcript_entries, max_chars)
        partial_summaries = []

        for idx, chunk in enumerate(chunks):
            chunk_text = build_transcript_text(chunk)
            chunk_prompt = build_prompt(chunk_text, user_prompt)
            raw = call_llm(SYSTEM_PROMPT, chunk_prompt, model_config)
            partial = parse_llm_response(raw)
            partial_summaries.append(partial)

        # Merge partial summaries
        merge_input = json.dumps(partial_summaries, indent=2)
        merge_prompt = f"Here are {len(partial_summaries)} partial summaries from different parts of the video. Merge them into one cohesive summary:\n\n{merge_input}"
        if user_prompt:
            merge_prompt += f'\n\nThe viewer specifically wanted to know: "{user_prompt}". Prioritize content related to this.'
        merge_prompt += "\n\nReturn ONLY valid JSON."

        raw = call_llm(MERGE_SYSTEM_PROMPT, merge_prompt, model_config)
        summary = parse_llm_response(raw)
    else:
        prompt = build_prompt(transcript_text, user_prompt)
        raw = call_llm(SYSTEM_PROMPT, prompt, model_config)
        summary = parse_llm_response(raw)

    # Validate quotes against transcript
    for retry in range(max_retries):
        bad_quotes = []
        for section in summary.get("sections", []):
            quote = section.get("quote", "")
            match = find_quote_timestamp(quote, transcript_entries, threshold=0.4)
            if match is None:
                bad_quotes.append(quote)
            else:
                section["_matched_start"] = match["start"]

        if not bad_quotes:
            break

        # Re-prompt for invalid quotes
        retry_msg = RETRY_PROMPT.format(
            bad_quotes="\n".join(f"- \"{q}\"" for q in bad_quotes)
        )
        transcript_text_for_retry = build_transcript_text(transcript_entries)
        # If we chunked, use a truncated version for retry
        if len(transcript_text_for_retry) > max_chars:
            transcript_text_for_retry = transcript_text_for_retry[:max_chars]
        retry_prompt = build_prompt(transcript_text_for_retry, user_prompt)
        full_retry = f"{retry_prompt}\n\n{retry_msg}"
        raw = call_llm(SYSTEM_PROMPT, full_retry, model_config)
        summary = parse_llm_response(raw)

    # Final pass: attach timestamps even if some quotes didn't match perfectly
    for section in summary.get("sections", []):
        if "_matched_start" not in section:
            quote = section.get("quote", "")
            match = find_quote_timestamp(quote, transcript_entries, threshold=0.2)
            if match:
                section["_matched_start"] = match["start"]
            else:
                section["_matched_start"] = 0.0

    return summary
