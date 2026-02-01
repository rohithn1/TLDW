/**
 * LLM integration for the TLDW Chrome extension.
 * Calls Anthropic or OpenAI APIs directly via fetch.
 */

import { TLDWConfig } from "./config.js";
import { TranscriptEntry, buildTranscriptText, findQuoteTimestamp } from "./transcript.js";

const SYSTEM_PROMPT = `You are a super chill video summarizer. Your vibe is laid back, friendly, and conversational -- like you're telling a friend about a video you just watched. Keep it real, keep it casual.

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

Keep the tone relaxed and conversational throughout. Like you're just vibing and breaking it down for a buddy.`;

const FOCUS_GENERAL =
  "Give me a general summary of the whole video, breaking it into the main topics covered.";

const FOCUS_SPECIFIC = (prompt: string) =>
  `The viewer specifically wants to know: "${prompt}". Focus your summary primarily on parts of the video related to this, but also briefly cover other major topics.`;

const USER_PROMPT_TEMPLATE = (transcript: string, focusInstruction: string) =>
  `Here's the video transcript:

${transcript}

${focusInstruction}

Remember: every "quote" field MUST be an exact copy-paste from the transcript above. Do not change even a single word. Return ONLY valid JSON.`;

const RETRY_PROMPT = (badQuotes: string[]) =>
  `Some of your quotes were not found in the original transcript. Here are the invalid quotes:

${badQuotes.map((q) => `- "${q}"`).join("\n")}

Please provide new exact quotes from the transcript for those sections. Remember: quotes must be EXACT substrings from the transcript -- copy them word for word.

Return the full JSON response again with corrected quotes. Return ONLY valid JSON, no markdown fences.`;

// Context limits per model (in tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-20250514": 200000,
  "gpt-5": 128000,
  "gpt-4o": 128000,
};
const DEFAULT_CONTEXT_LIMIT = 128000;
const RESERVED_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

export interface SummarySection {
  title: string;
  summary: string;
  quote: string;
  timestamp_hint: string;
  _matched_start: number;
}

export interface VideoSummary {
  one_liner: string;
  sections: SummarySection[];
}

/**
 * Call the appropriate LLM API based on config.
 */
async function callLLM(
  system: string,
  userMessage: string,
  config: TLDWConfig
): Promise<string> {
  if (config.provider === "anthropic") {
    return callAnthropic(system, userMessage, config);
  } else {
    return callOpenAI(system, userMessage, config);
  }
}

async function callAnthropic(
  system: string,
  userMessage: string,
  config: TLDWConfig
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(
  system: string,
  userMessage: string,
  config: TLDWConfig
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Parse the LLM JSON response, handling common formatting issues.
 */
function parseLLMResponse(raw: string): any {
  let text = raw.trim();
  // Strip markdown code fences if present
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    lines.shift(); // remove first fence line
    if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
      lines.pop();
    }
    text = lines.join("\n");
  }
  return JSON.parse(text);
}

function getMaxTranscriptChars(model: string): number {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
  const availableTokens = contextLimit - RESERVED_TOKENS;
  return availableTokens * CHARS_PER_TOKEN;
}

function chunkEntries(entries: TranscriptEntry[], maxChars: number): TranscriptEntry[][] {
  const chunks: TranscriptEntry[][] = [];
  let currentChunk: TranscriptEntry[] = [];
  let currentChars = 0;

  for (const entry of entries) {
    const minutes = Math.floor(entry.start / 60);
    const seconds = Math.floor(entry.start % 60);
    const lineLen = `[${minutes}:${seconds.toString().padStart(2, "0")}] ${entry.text}\n`.length;

    if (currentChars + lineLen > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }
    currentChunk.push(entry);
    currentChars += lineLen;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Summarize a YouTube video transcript using an LLM.
 * Handles chunking for long transcripts.
 */
export async function summarizeVideo(
  entries: TranscriptEntry[],
  userPrompt: string | null,
  config: TLDWConfig,
  onProgress?: (msg: string) => void
): Promise<VideoSummary> {
  const transcriptText = buildTranscriptText(entries);
  const maxChars = getMaxTranscriptChars(config.model);

  let summary: any;

  if (transcriptText.length > maxChars) {
    // Chunk and summarize
    const chunks = chunkEntries(entries, maxChars);
    onProgress?.(`Transcript is large (${chunks.length} chunks). Processing...`);

    const partials: any[] = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(`Summarizing chunk ${i + 1}/${chunks.length}...`);
      const chunkText = buildTranscriptText(chunks[i]);
      const focus = userPrompt ? FOCUS_SPECIFIC(userPrompt) : FOCUS_GENERAL;
      const prompt = USER_PROMPT_TEMPLATE(chunkText, focus);
      const raw = await callLLM(SYSTEM_PROMPT, prompt, config);
      partials.push(parseLLMResponse(raw));
    }

    // Merge
    onProgress?.("Merging summaries...");
    const mergeSystem = `You are a super chill video summarizer. Merge multiple partial summaries into one cohesive summary. Return ONLY valid JSON with the same structure: {"one_liner": "...", "sections": [...]}. Keep exact quotes from the partials.`;
    let mergePrompt = `Here are ${partials.length} partial summaries:\n\n${JSON.stringify(partials, null, 2)}`;
    if (userPrompt) {
      mergePrompt += `\n\nThe viewer specifically wanted to know: "${userPrompt}". Prioritize that.`;
    }
    mergePrompt += "\n\nReturn ONLY valid JSON.";
    const raw = await callLLM(mergeSystem, mergePrompt, config);
    summary = parseLLMResponse(raw);
  } else {
    onProgress?.("Thinking about this video...");
    const focus = userPrompt ? FOCUS_SPECIFIC(userPrompt) : FOCUS_GENERAL;
    const prompt = USER_PROMPT_TEMPLATE(transcriptText, focus);
    const raw = await callLLM(SYSTEM_PROMPT, prompt, config);
    summary = parseLLMResponse(raw);
  }

  // Validate and attach timestamps
  onProgress?.("Validating quotes...");
  for (const section of summary.sections || []) {
    const quote = section.quote || "";
    const match = findQuoteTimestamp(quote, entries, 0.4);
    if (match) {
      section._matched_start = match.start;
    }
  }

  // Retry once for bad quotes
  const badQuotes = (summary.sections || [])
    .filter((s: any) => s._matched_start === undefined)
    .map((s: any) => s.quote);

  if (badQuotes.length > 0) {
    onProgress?.("Fixing some quotes...");
    const focus = userPrompt ? FOCUS_SPECIFIC(userPrompt) : FOCUS_GENERAL;
    const retryTranscript = transcriptText.length > maxChars
      ? transcriptText.substring(0, maxChars)
      : transcriptText;
    const basePrompt = USER_PROMPT_TEMPLATE(retryTranscript, focus);
    const retryMsg = RETRY_PROMPT(badQuotes);
    const fullRetry = `${basePrompt}\n\n${retryMsg}`;

    try {
      const raw = await callLLM(SYSTEM_PROMPT, fullRetry, config);
      summary = parseLLMResponse(raw);

      for (const section of summary.sections || []) {
        const quote = section.quote || "";
        const match = findQuoteTimestamp(quote, entries, 0.4);
        if (match) {
          section._matched_start = match.start;
        }
      }
    } catch {
      // Keep the original summary if retry fails
    }
  }

  // Final pass: set timestamps for any remaining unmatched quotes
  for (const section of summary.sections || []) {
    if (section._matched_start === undefined) {
      const match = findQuoteTimestamp(section.quote || "", entries, 0.2);
      section._matched_start = match ? match.start : 0.0;
    }
  }

  return summary as VideoSummary;
}
