```
  _____ _      ______        __
 |_   _| |    |  _ \ \      / /
   | | | |    | | | \ \ /\ / /
   | | | |    | |_| |\ V  V /
   |_| |_|____|____/  \_/\_/
         |_____|
```

**Too Long; Didn't Watch** — Summarize YouTube videos with AI from the command line or your browser.

TL;DW fetches a video's transcript, sends it to an LLM, and returns a structured summary with timestamped sections, direct quotes, and clickable links back into the video. It works as both a **CLI tool** (Python) and a **Chrome extension** (TypeScript).

---

## Table of Contents

- [Features](#features)
- [CLI Tool](#cli-tool)
  - [Requirements](#requirements)
  - [Install](#install)
  - [API Keys](#api-keys)
  - [Usage](#usage)
  - [Configuration](#configuration)
  - [Supported Models](#supported-models)
- [Chrome Extension](#chrome-extension)
  - [Build](#build)
  - [Load in Chrome](#load-in-chrome)
  - [Extension Setup](#extension-setup)
  - [Extension Usage](#extension-usage)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [License](#license)

---

## Features

- Summarizes any YouTube video with English captions
- Produces a one-liner overview plus detailed sections with quotes and timestamps
- Supports Anthropic, OpenAI, and OpenRouter (20+ models)
- Focus mode: ask a specific question about the video with `--gimme`
- Available as a CLI and a Chrome extension

---

## CLI Tool

### Requirements

- **Python 3.13+**
- An API key for at least one provider (see [API Keys](#api-keys))

### Install

**One-liner install** (Linux / macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/rohithn1/TLDW/master/install.sh | bash
```

This will:
1. Verify Python 3.13+ is installed
2. Install [uv](https://github.com/astral-sh/uv) if needed
3. Clone the repo to `~/.local/share/tldw/`
4. Create a virtualenv and install dependencies
5. Place a `tldw` wrapper script in `~/.local/bin/`

If `~/.local/bin` is not on your `PATH`, add this to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

**Manual install** (or for development):

```bash
git clone https://github.com/rohithn1/TLDW.git
cd TLDW
uv venv .venv --python python3.13
source .venv/bin/activate
uv pip install .
```

Then run with `python -m tldw.cli` or `tldw` (if installed via pip entry point).

### API Keys

Set the environment variable for whichever provider you plan to use:

| Provider | Environment Variable | Get a key |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Anthropic | `ANTHROPIC_API_KEY` | https://console.anthropic.com/ |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |

```bash
# Example: add to ~/.bashrc or ~/.zshrc
export OPENROUTER_API_KEY="sk-or-v1-..."
```

OpenRouter is recommended as the default provider — it gives access to models from many providers through a single API key.

For Anthropic models without an API key, the CLI can fall back to the `claude` CLI if it is installed and authenticated.

### Usage

```bash
# Summarize a video
tldw "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Summarize with a specific question
tldw "https://youtu.be/abc123" --gimme "what were the key takeaways?"

# Short-form and embed URLs work too
tldw "https://youtube.com/shorts/abc123"
tldw "https://youtube.com/embed/abc123"

# Just a video ID also works
tldw "dQw4w9WgXcQ"

# Run interactive model setup
tldw --setup

# Change model configuration
tldw --config
```

**Example output:**

```
  _____ _      ______        __
 |_   _| |    |  _ \ \      / /
   | | | |    | | | \ \ /\ / /
   | | | |    | |_| |\ V  V /
   |_| |_|____|____/  \_/\_/
         |_____|

╭──────────── tl;dw ────────────╮
│  Rick Astley makes some       │
│  pretty serious promises      │
╰───────────────────────────────╯

╭──── #1 The Setup ─────────────╮
│  Rick opens with a bold       │
│  declaration about the rules  │
│  of love...                   │
│                               │
│  "never gonna give you up"    │
│                               │
│  [0:18]  https://youtube...   │
╰───────────────────────────────╯
```

### Configuration

Config is stored at `~/.config/tldw/config.json`:

```json
{
  "model": "google/gemini-3-flash-preview"
}
```

Custom models are stored alongside:

```json
{
  "model": "my-org/custom-model",
  "custom_model": {
    "id": "my-org/custom-model",
    "name": "my-org/custom-model (custom)",
    "provider": "openrouter",
    "model": "my-org/custom-model"
  }
}
```

Run `tldw --setup` at any time to change your model interactively.

### Supported Models

**Direct providers:**

| Model | Provider | Context Window |
|---|---|---|
| `anthropic/claude-opus-4` | Anthropic | 200k tokens |
| `openai/gpt-5` | OpenAI | 128k tokens |

**Via OpenRouter (default `google/gemini-3-flash-preview`):**

`google/gemini-3-flash-preview`, `anthropic/claude-sonnet-4.5`, `deepseek/deepseek-v3.2`, `google/gemini-2.5-flash`, `anthropic/claude-opus-4.5`, `x-ai/grok-4.1-fast`, `google/gemini-2.5-flash-lite`, `openai/gpt-oss-120b`, `google/gemini-3-pro-preview`, `openai/gpt-5.2`, `openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5`, `tngtech/deepseek-r1t2-chimera:free`, `qwen/qwen-plus-2025-07-28:thinking`, `openai/o3-pro`, `qwen/qwen3-next-80b-a3b-thinking`

You can also enter any custom model ID during `--setup`.

---

## Chrome Extension

The extension lets you summarize YouTube videos directly from your browser with a right-click context menu or the popup UI.

### Build

```bash
cd extension
npm install
npm run build
```

This compiles TypeScript from `src/` into `dist/` and copies public assets.

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` directory (can be found in `TLDW/extension/`)

### Extension Setup

1. Click the TL;DW extension icon in your toolbar
2. You'll see a "Set up TL;DW" banner — click it to open the options page
3. Choose a provider (OpenRouter is recommended)
4. Select a model from the dropdown, or toggle "Custom model" and enter any model ID
5. Paste your API key
6. Click **Save** and you're set

### Extension Usage

**Right-click method:**
1. Right-click any YouTube link on any page
2. Select **"Summarize with TL;DW"** from the context menu
3. The summary appears in a new tab

**Popup method:**
1. Click the TL;DW icon in your toolbar
2. Paste a YouTube URL
3. Optionally enter a question in "What do you want to know?"
4. Click **Summarize**

The extension supports the same YouTube URL formats as the CLI (`watch`, `shorts`, `youtu.be`, `embed`, `m.youtube.com`).

---

## How It Works

### Transcript Fetching

- **CLI**: Uses the [`youtube-transcript-api`](https://pypi.org/project/youtube-transcript-api/) Python library to fetch English captions.
- **Extension**: Calls YouTube's InnerTube API directly using an Android client context. A `declarativeNetRequest` rule rewrites the `Origin` and `Referer` headers to `https://www.youtube.com` so YouTube accepts the request from the extension context.

### Summarization Pipeline

1. **Extract video ID** from the URL (supports `v=`, `/v/`, `youtu.be/`, `embed/`, `shorts/`, bare IDs)
2. **Fetch transcript** — returns a list of `{text, start, duration}` entries
3. **Check context limits** — if the transcript exceeds the model's context window, it gets split into chunks
4. **Call the LLM** — each chunk (or the full transcript) is sent with a system prompt instructing the model to return structured JSON with a one-liner, sections, summaries, and exact quotes
5. **Merge chunks** — if chunked, partial summaries are merged via a second LLM call
6. **Validate quotes** — each quote is checked against the transcript using substring matching and word overlap scoring. Invalid quotes trigger a retry (up to 2 retries)
7. **Attach timestamps** — matched quotes are linked to their transcript entry's `start` time
8. **Render output** — CLI uses Rich panels; the extension renders HTML in the popup

### Focus Mode

When you pass `--gimme "your question"` (CLI) or enter a question in the extension, the LLM prompt is modified to prioritize content related to your question while still briefly covering other topics.

---

## Project Structure

```
TLDW/
├── install.sh              # One-liner installer for the CLI
├── pyproject.toml          # Python project metadata and dependencies
├── tldw/                   # CLI source code (Python)
│   ├── __init__.py
│   ├── __main__.py         # python -m tldw entry point
│   ├── cli.py              # Click CLI commands and interactive setup
│   ├── config.py           # Model list, config file management
│   ├── transcript.py       # YouTube transcript fetching, quote matching
│   ├── llm.py              # LLM calls, chunking, summarization pipeline
│   └── display.py          # Rich terminal output formatting
├── tests/                  # Python tests
│   ├── test_config.py
│   ├── test_integration.py
│   ├── test_llm.py
│   └── test_transcript.py
├── extension/              # Chrome extension (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── background.ts   # Service worker, context menu registration
│   │   ├── config.ts       # chrome.storage config management
│   │   ├── options.ts      # Settings page logic
│   │   ├── popup.ts        # Main popup UI logic
│   │   ├── transcript.ts   # InnerTube API transcript fetching
│   │   └── llm.ts          # LLM API calls from the browser
│   ├── public/
│   │   ├── manifest.json   # Chrome Extension Manifest v3
│   │   ├── popup.html      # Popup UI
│   │   ├── options.html    # Settings page
│   │   └── rules.json      # Declarative net request header rules
│   ├── icons/              # Extension icons (16, 48, 128px)
│   ├── dist/               # Compiled JS output
│   └── test/               # Extension tests (Puppeteer)
└── README.md
```

---

## Running Tests

**CLI tests** (from the project root):

```bash
# Install test dependencies
uv pip install ".[test]"

# Run all tests
pytest

# Run a specific test file
pytest tests/test_transcript.py
```

**Extension tests** (from the `extension/` directory):

```bash
cd extension
npm install
npm run build

# Unit tests
npm run test:unit

# End-to-end tests (requires Chrome/Chromium)
npm run test:e2e

# All tests
npm run test:all
```
