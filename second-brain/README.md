# Second Brain

A private, local-only RAG system built directly into your Chrome browser. It indexes the web pages you visit, generating vector embeddings locally via WASM, and storing them in an in-browser PostgreSQL (PGlite + pgvector) database. You can then ask questions about what you've read, and it will answer with citations back to the original source.

## Installation (Load Unpacked)

1. Clone or download this repository.
2. Run `npm install` and `npm run build`.
3. Open Google Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** in the top right corner.
5. Click **Load unpacked** and select the `.output/chrome-mv3` folder inside this repository.
6. Open the Extension Side Panel, enter your API key in the settings, and start browsing!

## Features

- **Capture Pipeline**: Uses `Readability.js` to strip out navigation, ads, and boilerplate, indexing only the core article content.
- **Deduplication Engine**: Uses an optimized 64-bit SimHash and Hamming Distance to flag near-duplicate pages (e.g. repeated visits or minor updates).
- **Temporal Retrieval**: Results decay exponentially based on age, prioritizing recent reading when semantic similarity is equal. Time-scoped parsing supports natural language filters (e.g. "last week").
- **Maximal Marginal Relevance (MMR)**: Diverse chunk retrieval prevents the LLM from over-indexing on a single page, fetching diverse sources.
- **Negative Rejection**: The RAG pipeline respects when information is simply not there. If relevance thresholds aren't met, it confidently states: "Not in your history."

## Privacy Model & Threat Analysis

This extension is built with **Privacy by Default**:
1. **Local-Only Embeddings**: The embedding model (Transformers.js / `all-MiniLM-L6-v2`) runs directly inside an offscreen Chrome document via WebAssembly. **No text data is ever sent to a third-party embedding server.**
2. **Local Vector Storage**: All captured text, vectors, and metadata are stored in `PGlite` over IndexedDB, completely siloed within the browser profile.
3. **Strict Content Security Policy**: The extension manifest implements strict `connect-src` limits. Network calls are restricted exclusively to:
   - Your chosen LLM API endpoint (`api.groq.com`, `generativelanguage.googleapis.com`, `localhost:11434`).
   - Hugging Face CDNs for fetching the open-source embedding model weights on first load.
4. **Blocklists**: Banking, health, email, and authentication URLs are hardcoded out of the capture pipeline. Users can add custom domain blocklists.

## Evaluation Framework

To run the automated evaluation against your real browsing history:
1. Populate `eval/questions.json` with 30 questions based on your own actual reading from the past 2 weeks (ensure it includes Direct, Multi-Hop, Time-Scoped, and Negative questions).
2. Open the Second Brain **Settings Panel** in Chrome.
3. Click the **"Open Eval Runner"** button under Evaluation Tools.
4. Upload your `eval/questions.json` file.
5. The runner will execute all queries against your real IndexedDB and automatically download the results as `eval-logs-output.json`.
6. Analyze the output and populate `FINDINGS.md`.
