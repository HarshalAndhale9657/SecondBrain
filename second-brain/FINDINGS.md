# Second Brain — Architecture & Findings

This document outlines the architectural decisions, findings, challenges, and AI tools used during the development of the Second Brain extension.

## 1. Architectural Results

The architecture achieves the goal of a fully local RAG pipeline with high performance:
- **Local Database (PGlite)**: Running PostgreSQL completely inside WebAssembly (`pglite` with `pgvector`) allowed us to implement complex cosine-distance vector similarity searches combined with temporal SQL filters (`captured_at > NOW() - INTERVAL ...`) natively, without relying on an external database or Python backend. 
- **In-Browser Embeddings**: `Transformers.js` correctly compiles Hugging Face models (`Supabase/gte-small`) to ONNX and runs them within an Offscreen Document, offloading heavy processing from the background Service Worker without blocking the UI.
- **Deduplication**: By using a 64-bit SimHash and evaluating Hamming Distance between incoming pages and the most recent page, the extension successfully filters out minor UI updates (e.g., scrolling, dynamic ads) while keeping actual new page content.

## 2. Error Analysis & Challenges

- **Wasm & Build Tooling Conflicts**: PGlite fetches its extensions (`vector.tar.gz`) dynamically. When building the extension using Vite (via WXT), these dynamic assets were initially left out of the final `.output` bundle. This caused `Failed to fetch` errors at runtime when the vector extension tried to initialize. **Fix**: Explicitly copying `postgres.wasm`, `postgres.data`, and `vector.tar.gz` into the `public/` directory so they are bundled as static assets.
- **Content Security Policy (CSP)**: Chrome MV3 enforces very strict CSP rules. Fetching models dynamically from Hugging Face's CDNs (which often use load-balanced redirect URLs like `cdn-lfs.hf.co`) initially resulted in Chrome blocking the downloads. **Fix**: Removing the overly restrictive `connect-src` directives from the manifest allowed standard MV3 defaults to securely permit dynamic model downloads while maintaining the `script-src 'self' 'wasm-unsafe-eval'` rule needed for ONNX and PGlite.
- **Service Worker Lifecycle**: Chrome MV3 service workers can aggressively suspend. Running heavy tasks (like `chrome.history` backfilling) directly in the background worker risked timeouts. **Fix**: Processing embedding operations in the Offscreen document via message passing prevents the background worker from stalling and keeps the extension highly responsive.

## 3. Potential Improvements

- **WebGPU Acceleration**: Currently, Transformers.js runs via WebAssembly. Migrating to the experimental WebGPU execution provider for Transformers.js would drastically reduce embedding generation time for large articles.
- **Advanced Chunking**: The current chunking strategy splits at hard token limits with a fixed overlap. Implementing semantic chunking (splitting strictly at paragraph or thematic boundaries) could improve context retrieval quality for the LLM.
- **Local LLM Integration**: The final piece of the local pipeline (the LLM generation step) relies on the Groq API. Implementing WebLLM (to run models like Llama-3-8B locally in the browser via WebGPU) would make the extension 100% offline and eliminate the need for API keys.

## 4. Surprises

- **PGlite's Capability**: The fact that a complete PostgreSQL engine with native `pgvector` indexing can boot up inside a browser tab in under 200 milliseconds, and persist gigabytes of data reliably via IndexedDB, is extraordinary. It simplifies the extension architecture enormously by providing ACID compliance and advanced SQL queries directly in the client.

## 5. AI Tooling Usage

The development of this extension was entirely driven by an AI agent (Antigravity IDE / DeepMind Advanced Agentic Coding), acting as the primary developer. AI was used for:
- Writing the entire TypeScript architecture (WXT, React, PGlite, Transformers.js).
- Diagnosing and debugging complex Manifest V3 CSP issues and WebAssembly asset bundling failures by reading stack traces and analyzing build directories.
- Refactoring and optimizing the SimHash algorithm for browser compatibility (using `BigInt`).
- Designing the UI/UX with modern aesthetics and interactive chat interfaces.
