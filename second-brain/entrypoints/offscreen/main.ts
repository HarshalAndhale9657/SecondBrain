/**
 * Offscreen Document — ML inference engine for Transformers.js embeddings.
 *
 * This document provides a persistent execution context with full DOM and WASM
 * access, circumventing the Service Worker's ephemeral lifecycle and API limitations.
 *
 * Listens for EMBED_TEXT messages from the Service Worker, runs the embedding
 * pipeline, and returns results via EMBED_RESPONSE messages.
 */

import { embedBatch } from "@/lib/embedding/pipeline";
import type { EmbedTextMessage, EmbedResponseMessage } from "@/lib/messages";

chrome.runtime.onMessage.addListener(
  (message: EmbedTextMessage, _sender, sendResponse) => {
    // Health-check handler — background can verify we're alive
    if ((message as any).type === "PING") {
      sendResponse({ pong: true });
      return true;
    }

    if (message.type !== "EMBED_TEXT") return;

    const { requestId, texts } = message.payload;

    embedBatch(texts)
      .then((embeddings) => {
        const response: EmbedResponseMessage = {
          type: "EMBED_RESPONSE",
          payload: {
            requestId,
            embeddings: embeddings.map((e) => Array.from(e)),
          },
        };
        chrome.runtime.sendMessage(response);
      })
      .catch((error) => {
        const response: EmbedResponseMessage = {
          type: "EMBED_RESPONSE",
          payload: {
            requestId,
            embeddings: [],
            error: error instanceof Error ? error.message : "Embedding failed",
          },
        };
        chrome.runtime.sendMessage(response);
      });
  }
);

console.debug("[SecondBrain] Offscreen inference engine ready.");
