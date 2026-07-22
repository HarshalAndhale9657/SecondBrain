# Second Brain

A privacy-first Chrome extension that indexes your browsing history locally and answers natural-language questions with citations — "you read this on example.com, three days ago."

Everything runs on your machine. No data leaves the browser.

## Architecture

```
Content Script → Service Worker → Offscreen Document → Side Panel
  (capture)       (route + dedup)    (ML inference)      (UI)
```

- **Capture**: Readability.js extracts article content; MutationObserver handles SPAs
- **Dedup**: 64-bit SimHash with Hamming distance thresholds collapses re-visits
- **Embed**: Transformers.js (all-MiniLM-L6-v2, 384-dim) runs in an Offscreen Document via WASM
- **Store**: PGlite (PostgreSQL WASM) + pgvector with HNSW indexing, persisted in IndexedDB
- **Retrieve**: Cosine similarity + temporal decay re-ranking + MMR diversification
- **Generate**: Groq free tier (Llama 3.1 8B) with grounded system prompts

## Install

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/second-brain.git
cd second-brain
npm install

# Build the extension
npm run build

# Load in Chrome:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the .output/chrome-mv3 directory
```

## Configuration

1. Click the extension icon to open the Side Panel
2. Go to **Settings** tab
3. Set your **Groq API key** (free at https://console.groq.com)
4. (Optional) Adjust blocked domains

## Usage

- Browse the web normally — pages are captured and indexed automatically
- Click the extension icon to open the Side Panel
- **Ask tab**: Type natural-language questions about your browsing history
- **Index tab**: Browse and manage indexed pages
- **Settings tab**: Configure LLM, manage blocklist, trigger backfill, wipe data

## Privacy Model

- All text extraction, deduplication, and embedding happen locally in the browser
- The only outbound requests are:
  - One-time model download from Hugging Face CDN (~30MB)
  - LLM API calls to Groq (query context only, no raw browsing data)
- Default blocklist excludes banking, email, health, and authentication pages
- Users can pause capture, block domains, delete entries, or wipe the entire index
- `declarativeNetRequest` rules block all other outbound traffic from the extension

## Running the Evaluation

```bash
# Ensure questions.json is populated with your real browsing data
npm run eval
# Results are written to eval/logs/
```

## Project Structure

```
second-brain/
├── entrypoints/
│   ├── background.ts          # Service Worker (event router)
│   ├── content.ts             # Content Script (DOM capture)
│   ├── offscreen.html/.ts     # Offscreen Document (ML inference)
│   └── sidepanel/             # Side Panel UI (React)
├── lib/
│   ├── capture/               # Readability, SPA detection, URL cleaning
│   ├── dedup/                 # SimHash implementation
│   ├── embedding/             # Transformers.js pipeline, text chunker
│   ├── generation/            # LLM client (Groq/Gemini/Ollama)
│   ├── privacy/               # Blocklist, network rules
│   ├── retrieval/             # Vector search, temporal decay, MMR
│   ├── storage/               # PGlite + pgvector database layer
│   └── messages.ts            # Type-safe message protocol
├── eval/
│   ├── questions.json         # 30 eval questions with ground truth
│   └── logs/                  # Per-question retrieval + answer logs
├── FINDINGS.md
└── README.md
```

## Tech Stack

| Component | Technology | Cost |
|-----------|-----------|------|
| Framework | WXT + Vite + TypeScript | $0 |
| Content Extraction | @mozilla/readability | $0 |
| Deduplication | Custom SimHash (FNV-1a, 64-bit) | $0 |
| Embeddings | Transformers.js + all-MiniLM-L6-v2 | $0 |
| Vector Store | PGlite + pgvector (IndexedDB) | $0 |
| LLM | Groq free tier (Llama 3.1 8B) | $0 |
| UI | React (Side Panel) | $0 |

## AI Usage Disclosure

AI tools were used extensively throughout the build process for code generation, architecture design, and debugging. The evaluation dataset (questions.json) and all findings are manually verified against real browsing data.
