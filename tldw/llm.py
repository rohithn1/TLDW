"""LLM integration for summarization."""

import json
import os
import subprocess


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


def summarize_video(
    transcript_entries: list[dict],
    user_prompt: str | None,
    model_config: dict,
    max_retries: int = 2,
) -> dict:
    """Run the full summarization pipeline with quote validation.

    Returns the parsed summary dict with validated quotes and timestamps.
    """
    transcript_text = build_transcript_text(transcript_entries)
    prompt = build_prompt(transcript_text, user_prompt)

    raw = call_llm(SYSTEM_PROMPT, prompt, model_config)
    summary = parse_llm_response(raw)

    # Validate quotes against transcript
    for retry in range(max_retries):
        bad_quotes = []
        for section in summary.get("sections", []):
            quote = section.get("quote", "")
            from tldw.transcript import find_quote_timestamp
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
        full_retry = f"{prompt}\n\n{retry_msg}"
        raw = call_llm(SYSTEM_PROMPT, full_retry, model_config)
        summary = parse_llm_response(raw)

    # Final pass: attach timestamps even if some quotes didn't match perfectly
    for section in summary.get("sections", []):
        if "_matched_start" not in section:
            quote = section.get("quote", "")
            from tldw.transcript import find_quote_timestamp
            match = find_quote_timestamp(quote, transcript_entries, threshold=0.2)
            if match:
                section["_matched_start"] = match["start"]
            else:
                section["_matched_start"] = 0.0

    return summary
