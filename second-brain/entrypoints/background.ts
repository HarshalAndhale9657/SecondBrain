/**
 * Background Service Worker — central event router and control plane.
 *
 * Responsibilities:
 * 1. Receive captured pages from Content Scripts
 * 2. Run SimHash deduplication against existing index
 * 3. Route unique content to Offscreen Document for embedding
 * 4. Store documents and chunks in PGlite
 * 5. Handle queries from the Side Panel (retrieval + generation)
 * 6. Manage Offscreen Document lifecycle
 * 7. Handle backfill requests
 */

import {
  computeSimHash,
  hammingDistance,
  splitSimHash,
  joinSimHash,
  classifyDuplicate,
  DedupAction,
} from "@/lib/dedup/simhash";
import { chunkText } from "@/lib/embedding/chunker";
import {
  insertDocument,
  insertChunk,
  updateLastVisited,
  getAllSimHashes,
  getAllDocuments,
  getIndexStats,
  deleteDocument,
  wipeDatabase,
  vectorSearch,
  flagNearDuplicate,
} from "@/lib/storage/pglite-db";
import { isUrlBlocked, togglePause, isPaused, loadBlocklistConfig, blockDomain, unblockDomain } from "@/lib/privacy/blocklist";
import { generateAnswer, loadLLMConfig, saveLLMConfig } from "@/lib/generation/llm-client";
import {
  applyTemporalDecay,
  parseTimeScope,
  shouldRejectAsAbsent,
} from "@/lib/retrieval/search";
import { cleanUrl } from "@/lib/capture/url-cleaner";
import type { ExtensionMessage } from "@/lib/messages";

export default defineBackground(() => {
  // ─── Constants ────────────────────────────────────────────────────────

  const EMBEDDING_TIMEOUT_MS = 90_000;
  const EMBEDDING_MAX_RETRIES = 2;
  const EMBEDDING_RETRY_DELAY_MS = 3_000;

  // ─── Offscreen Document Management ─────────────────────────────────

  let offscreenReady = false;

  /**
   * Ensure the Offscreen Document is alive.
   * Clears stale flag and re-creates if Chrome destroyed it.
   */
  async function ensureOffscreenDocument(): Promise<void> {
    // Always verify via Chrome API — never trust the in-memory flag alone
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      offscreenReady = true;
      return;
    }

    // Flag was stale — Chrome killed the document. Reset and recreate.
    offscreenReady = false;

    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Run Transformers.js embedding model via WASM",
      });
      offscreenReady = true;
    } catch (err: unknown) {
      // If another call already created it (race condition), that's fine
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Only a single offscreen")) {
        throw err;
      }
      offscreenReady = true;
    }
  }

  /**
   * Send texts to the Offscreen Document for embedding and wait for results.
   * Includes timeout and retry logic for robustness.
   */
  async function requestEmbeddings(
    texts: string[],
    retryCount: number = 0
  ): Promise<number[][]> {
    await ensureOffscreenDocument();

    const requestId = crypto.randomUUID();

    return new Promise<number[][]>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout>;

      const handler = (message: ExtensionMessage) => {
        if (
          message.type === "EMBED_RESPONSE" &&
          (message as any).payload.requestId === requestId
        ) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          chrome.runtime.onMessage.removeListener(handler);

          const payload = (message as any).payload;
          if (payload.error) {
            reject(new Error(payload.error));
          } else {
            resolve(payload.embeddings);
          }
        }
      };

      chrome.runtime.onMessage.addListener(handler);

      chrome.runtime.sendMessage({
        type: "EMBED_TEXT",
        payload: { requestId, texts },
      });

      timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        chrome.runtime.onMessage.removeListener(handler);

        // Retry with backoff
        if (retryCount < EMBEDDING_MAX_RETRIES) {
          const delay = EMBEDDING_RETRY_DELAY_MS * Math.pow(2, retryCount);
          console.warn(
            `[SecondBrain] Embedding timeout, retrying in ${delay}ms (attempt ${retryCount + 1}/${EMBEDDING_MAX_RETRIES})`
          );
          // Reset offscreen flag so it gets re-checked on retry
          offscreenReady = false;
          setTimeout(() => {
            requestEmbeddings(texts, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, delay);
        } else {
          reject(new Error("Embedding request timed out after retries"));
        }
      }, EMBEDDING_TIMEOUT_MS);
    });
  }

  // ─── Page Capture Pipeline ─────────────────────────────────────────

  async function processCapture(
    url: string,
    title: string,
    textContent: string,
    excerpt: string,
    byline: string | null,
    capturedAt: string,
    isBackfill: boolean = false
  ): Promise<void> {
    // Check blocklist
    const blocked = await isUrlBlocked(url);
    if (blocked) {
      console.debug("[SecondBrain] Blocked:", url);
      return;
    }

    // Compute SimHash for dedup
    const simhash = computeSimHash(textContent);
    const { hi, lo } = splitSimHash(simhash);

    // Compare against existing documents
    const existingHashes = await getAllSimHashes();
    let dedupAction: string = DedupAction.DISTINCT;
    let matchedDocId: number | null = null;

    for (const existing of existingHashes) {
      const existingHash = joinSimHash(existing.simhash_hi, existing.simhash_lo);
      const distance = hammingDistance(simhash, existingHash);
      const action = classifyDuplicate(distance);

      if (action === DedupAction.IDENTICAL) {
        dedupAction = DedupAction.IDENTICAL;
        matchedDocId = existing.doc_id;
        break;
      }

      if (action === DedupAction.NEAR_DUPLICATE && dedupAction === DedupAction.DISTINCT) {
        dedupAction = DedupAction.NEAR_DUPLICATE;
        matchedDocId = existing.doc_id;
      }
    }

    // Handle dedup decision
    if (dedupAction === DedupAction.IDENTICAL && matchedDocId !== null) {
      // Exact duplicate: just update timestamp
      await updateLastVisited(matchedDocId);
      console.debug("[SecondBrain] Duplicate detected, updated timestamp:", url);
      return;
    }

    // Insert the document
    const docId = await insertDocument(
      url,
      title,
      textContent,
      excerpt,
      byline,
      hi,
      lo,
      capturedAt,
      isBackfill
    );

    if (dedupAction === DedupAction.NEAR_DUPLICATE && matchedDocId !== null) {
      // Near-duplicate: store but flag for retrieval collapse
      await flagNearDuplicate(docId, matchedDocId);
      console.debug("[SecondBrain] Near-duplicate flagged:", url);
    }

    // Chunk the text
    const chunks = chunkText(textContent, url, title, capturedAt);

    if (chunks.length === 0) {
      console.debug("[SecondBrain] No chunks produced:", url);
      return;
    }

    // Request embeddings from Offscreen Document
    const chunkTexts = chunks.map((c) => c.text);

    try {
      const embeddings = await requestEmbeddings(chunkTexts);

      // Store chunks with embeddings
      for (let i = 0; i < chunks.length; i++) {
        await insertChunk(
          docId,
          chunks[i].metadata.chunkIndex,
          chunks[i].text,
          new Float32Array(embeddings[i]),
          chunks[i].metadata.sourceUrl,
          chunks[i].metadata.documentTitle,
          chunks[i].metadata.capturedAt
        );
      }

      console.debug(
        `[SecondBrain] Indexed ${chunks.length} chunks from: ${url}`
      );
    } catch (err) {
      console.error("[SecondBrain] Embedding failed:", err);
    }
  }

  // ─── Query Pipeline ────────────────────────────────────────────────

  async function handleQuery(
    query: string,
    requestId: string
  ): Promise<void> {
    try {
      // Guard: check if database has any content before doing expensive work
      const stats = await getIndexStats();
      if (stats.chunkCount === 0) {
        chrome.runtime.sendMessage({
          type: "QUERY_RESPONSE",
          payload: {
            requestId,
            answer: "Your index is empty. Browse some pages first so I have something to search.",
            citations: [],
            retrievedChunks: [],
            isNegative: true,
          },
        });
        return;
      }

      // Parse time scope from query
      const timeScope = parseTimeScope(query);

      // Embed the query
      const queryEmbeddings = await requestEmbeddings([query]);
      const queryEmbedding = new Float32Array(queryEmbeddings[0]);

      // Vector search with optional date filtering
      const results = await vectorSearch(
        queryEmbedding,
        20,
        timeScope?.from,
        timeScope?.to
      );

      // Check for negative case
      if (shouldRejectAsAbsent(results)) {
        chrome.runtime.sendMessage({
          type: "QUERY_RESPONSE",
          payload: {
            requestId,
            answer: "Not in your history.",
            citations: [],
            retrievedChunks: [],
            isNegative: true,
          },
        });
        return;
      }

      // Apply temporal decay
      const decayedResults = applyTemporalDecay(results);
      decayedResults.sort((a, b) => b.finalScore - a.finalScore);

      // Take top 5 for LLM context
      const topResults = decayedResults.slice(0, 5);

      // Generate answer
      const contextChunks = topResults.map((r) => ({
        text: r.chunk_text,
        sourceUrl: r.source_url,
        documentTitle: r.document_title,
        capturedAt: r.captured_at,
      }));

      const response = await generateAnswer({
        query,
        contextChunks,
      });

      chrome.runtime.sendMessage({
        type: "QUERY_RESPONSE",
        payload: {
          requestId,
          answer: response.answer,
          citations: response.citations,
          retrievedChunks: topResults.map((r) => ({
            text: r.chunk_text,
            sourceUrl: r.source_url,
            similarity: r.similarity,
          })),
          isNegative: false,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      chrome.runtime.sendMessage({
        type: "QUERY_RESPONSE",
        payload: {
          requestId,
          answer: "",
          citations: [],
          retrievedChunks: [],
          isNegative: false,
          error: errorMessage,
        },
      });
    }
  }

  // ─── History Backfill ──────────────────────────────────────────────

  async function handleBackfill(
    maxUrls: number,
    daysBack: number
  ): Promise<void> {
    const startTime = Date.now() - daysBack * 24 * 3600 * 1000;

    const historyItems = await chrome.history.search({
      text: "",
      maxResults: maxUrls,
      startTime,
    });

    console.debug(
      `[SecondBrain] Backfill: found ${historyItems.length} history items`
    );

    for (const item of historyItems) {
      if (!item.url) continue;

      const blocked = await isUrlBlocked(item.url);
      if (blocked) continue;

      // Signal content script to capture this page
      try {
        const tab = await chrome.tabs.create({
          url: item.url,
          active: false,
        });

        // Wait for page to load
        await new Promise<void>((resolve) => {
          const listener = (
            tabId: number,
            changeInfo: chrome.tabs.TabChangeInfo
          ) => {
            if (tabId === tab.id && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);

          // Timeout fallback
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 10000);
        });

        // Signal content script to capture
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "CAPTURE_CURRENT_PAGE",
            });
          } catch {
            // Content script may not be injected yet
          }

          // Wait a bit for capture to complete
          await new Promise((r) => setTimeout(r, 2000));

          // Close the background tab
          await chrome.tabs.remove(tab.id);
        }
      } catch (err) {
        console.debug("[SecondBrain] Backfill error for:", item.url, err);
      }
    }
  }

  // ─── SPA Navigation Monitoring ─────────────────────────────────────

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return; // Only main frame

    chrome.tabs.sendMessage(details.tabId, {
      type: "SPA_NAVIGATION",
      url: details.url,
    }).catch(() => {
      // Content script may not be injected
    });
  });

  // ─── Message Router ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      switch (message.type) {
        case "PAGE_CAPTURED":
          processCapture(
            message.payload.url,
            message.payload.title,
            message.payload.textContent,
            message.payload.excerpt,
            message.payload.byline,
            message.payload.capturedAt
          ).then(() => sendResponse({ success: true }))
           .catch((err) => sendResponse({ success: false, error: err.message }));
          return true;

        case "RUN_EVAL_QUERY": {
          const reqId = crypto.randomUUID();

          // Set up a listener to intercept the QUERY_RESPONSE for this reqId
          const listener = (msg: any) => {
            if (msg.type === "QUERY_RESPONSE" && msg.payload.requestId === reqId) {
              chrome.runtime.onMessage.removeListener(listener);
              sendResponse(msg.payload);
            }
          };
          chrome.runtime.onMessage.addListener(listener);

          handleQuery(message.payload.query, reqId).catch((err) => {
            chrome.runtime.onMessage.removeListener(listener);
            sendResponse({ error: err.message });
          });

          // Must return true to keep sendResponse channel open
          return true;
        }

        case "QUERY":
          handleQuery(message.payload.query, message.payload.requestId);
          return false; // Response sent via separate message

        case "GET_DOCUMENTS":
          getAllDocuments()
            .then((docs) => sendResponse({ documents: docs }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "GET_STATS":
          getIndexStats()
            .then((stats) => sendResponse(stats))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "DELETE_DOCUMENT":
          deleteDocument(message.payload.docId)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "WIPE_DATABASE":
          wipeDatabase()
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "TOGGLE_PAUSE":
          togglePause()
            .then((paused) => sendResponse({ isPaused: paused }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "GET_PAUSE_STATE":
          isPaused()
            .then((paused) => sendResponse({ isPaused: paused }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "TRIGGER_BACKFILL":
          handleBackfill(message.payload.maxUrls, message.payload.daysBack)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "UPDATE_BLOCKLIST":
          (message.payload.action === "block"
            ? blockDomain(message.payload.domain)
            : unblockDomain(message.payload.domain)
          )
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "GET_BLOCKLIST":
          loadBlocklistConfig()
            .then((config) => sendResponse(config))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        case "SAVE_LLM_CONFIG": {
          const baseUrls: Record<string, string> = {
            groq: "https://api.groq.com/openai/v1",
            gemini: "https://generativelanguage.googleapis.com/v1beta",
            ollama: "http://localhost:11434",
          };
          saveLLMConfig({
            provider: message.payload.provider,
            apiKey: message.payload.apiKey,
            model: message.payload.model,
            baseUrl: baseUrls[message.payload.provider],
          })
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));
          return true;
        }

        case "GET_LLM_CONFIG":
          loadLLMConfig()
            .then((config) => sendResponse(config))
            .catch((err) => sendResponse({ error: err.message }));
          return true;

        default:
          return false;
      }
    }
  );

  // ─── Side Panel Setup ──────────────────────────────────────────────

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  console.debug("[SecondBrain] Service Worker initialized.");
});
