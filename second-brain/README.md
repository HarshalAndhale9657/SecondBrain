# Second Brain — Local AI Browsing Assistant

Second Brain is a privacy-first, fully local Retrieval-Augmented Generation (RAG) Chrome Extension. It passively indexes your browsing history using in-browser vector embeddings and a local WebAssembly Postgres database, allowing you to ask questions about anything you've read online — all without your browsing history ever leaving your device.

## Features

- **100% Local Pipeline**: Embeddings are generated entirely in the browser using Transformers.js (`Supabase/gte-small`).
- **WebAssembly PostgreSQL**: Uses PGLite with `pgvector` to run a fully functional vector database directly in the browser via IndexedDB.
- **Privacy-First**: Your browsing data never leaves your device. Only the final synthesized LLM queries (which you explicitly ask) are sent to the LLM (Groq API by default).
- **Temporal Search & Deduplication**: Employs exponential time decay for vector searches and SimHash (64-bit) for near-duplicate detection to avoid indexing the exact same page multiple times.
- **Background Backfill**: Instantly indexes your recent browsing history upon installation using the Chrome History API and an offscreen document pipeline.

## Installation & Setup

1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load into Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner.
   - Click "Load unpacked" and select the `.output/chrome-mv3` folder inside the project.
5. Set your API Key:
   - Click the extension icon to open the Second Brain Side Panel.
   - Navigate to the **Settings** tab.
   - Enter your Groq API Key (required for LLM generation).

## Usage

- **Capture**: Just browse! Pages are automatically captured, chunked, and embedded in the background as you read them.
- **Ask**: Open the Side Panel and ask questions like "What was that article about ChatGPT writers?" or "What recipes did I look at yesterday?".
- **Manage**: Go to the **Index** tab in the Side Panel to view, search, and manually delete indexed pages.
- **Privacy Controls**: Use the Settings tab to pause capture or add domains to your blocklist (e.g., `bank.com`). By default, common sensitive domains are already blocked.

## Running the Evaluation

The extension includes a built-in evaluation runner to test the RAG pipeline against a custom dataset:

1. Create a `questions.json` file structured similarly to the provided template in `eval/questions.json`.
2. Open Chrome and navigate to: `chrome-extension://<YOUR_EXTENSION_ID>/eval-runner.html`
3. Upload your `questions.json` file.
4. The runner will silently execute the pipeline for each question against your actual browsing history database and prompt you to download a `eval-logs-output.json` file containing the retrieved chunks, answers, and metadata.

## Security Model

- **Content Security Policy (CSP)**: The extension uses a strict CSP. Outbound connections are locked down. 
- **LLM Independence**: No browsing history is used to train the LLM. The local vector database acts as a hard boundary.
