/**
 * Embedding Pipeline — Transformers.js inference for the Offscreen Document.
 *
 * Loads the all-MiniLM-L6-v2 model (384-dim) via ONNX Runtime WASM backend.
 * The model weights are downloaded once from Hugging Face and cached via
 * the browser's Cache Storage API for fully offline subsequent use.
 *
 * This module is designed to run exclusively inside the Offscreen Document,
 * which provides a persistent execution context with DOM and WASM access.
 */

import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";

/** Model configuration. */
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

/** Singleton pipeline instance. */
let embeddingPipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Configure Transformers.js to load ONNX runtime binaries from the
 * extension's local assets instead of the remote CDN.
 *
 * This is required to comply with MV3's Content Security Policy which
 * blocks remote code execution.
 */
function configureLocalPaths(): void {
  // Point to locally bundled ONNX runtime binaries
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");

  // Allow local model caching
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

/**
 * Initialize the embedding pipeline. Loads model weights on first call
 * and reuses the cached instance for subsequent calls.
 *
 * This is the most expensive operation — model weights (~30MB) are
 * downloaded once and cached in browser storage.
 */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) return embeddingPipeline;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    configureLocalPaths();

    const pipe = await pipeline("feature-extraction", MODEL_ID, {
      quantized: true,
    });

    embeddingPipeline = pipe;
    return pipe;
  })();

  return initPromise;
}

/**
 * Generate a normalized embedding vector for a single text string.
 * Returns a Float32Array of dimension 384.
 */
export async function embedText(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();

  const output = await pipe(text, {
    pooling: "mean",
    normalize: true,
  });

  // Extract the embedding from the nested tensor structure
  return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple text chunks in batch.
 * Returns an array of Float32Array embeddings, one per input text.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getEmbeddingPipeline();

  const results: Float32Array[] = [];

  // Process one at a time to avoid memory pressure in the browser
  for (const text of texts) {
    const output = await pipe(text, {
      pooling: "mean",
      normalize: true,
    });
    results.push(new Float32Array(output.data));
  }

  return results;
}

/**
 * Get the expected embedding dimension.
 */
export function getEmbeddingDim(): number {
  return EMBEDDING_DIM;
}
