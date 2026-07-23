/**
 * Message Protocol — type-safe inter-runtime communication.
 *
 * Defines all message types exchanged between Content Script, Service Worker,
 * Offscreen Document, and Side Panel via chrome.runtime messaging.
 */

// ─── Content Script → Service Worker ─────────────────────────────────────

export interface PageCapturedMessage {
  type: "PAGE_CAPTURED";
  payload: {
    url: string;
    title: string;
    textContent: string;
    excerpt: string;
    byline: string | null;
    capturedAt: string;
  };
}

// ─── Service Worker → Offscreen Document ─────────────────────────────────

export interface EmbedTextMessage {
  type: "EMBED_TEXT";
  payload: {
    requestId: string;
    texts: string[];
  };
}

export interface EmbedResponseMessage {
  type: "EMBED_RESPONSE";
  payload: {
    requestId: string;
    embeddings: number[][];
    error?: string;
  };
}

// ─── Side Panel → Service Worker ─────────────────────────────────────────

export interface QueryMessage {
  type: "QUERY";
  payload: {
    requestId: string;
    query: string;
    conversationHistory?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
  };
}

export interface QueryResponseMessage {
  type: "QUERY_RESPONSE";
  payload: {
    requestId: string;
    answer: string;
    citations: Array<{
      index: number;
      url: string;
      title: string;
    }>;
    retrievedChunks: Array<{
      text: string;
      sourceUrl: string;
      similarity: number;
    }>;
    isNegative: boolean;
    error?: string;
  };
}

// ─── Side Panel → Service Worker (Index Management) ──────────────────────

export interface GetDocumentsMessage {
  type: "GET_DOCUMENTS";
}

export interface GetStatsMessage {
  type: "GET_STATS";
}

export interface DeleteDocumentMessage {
  type: "DELETE_DOCUMENT";
  payload: { docId: number };
}

export interface WipeDatabaseMessage {
  type: "WIPE_DATABASE";
}

export interface TogglePauseMessage {
  type: "TOGGLE_PAUSE";
}

export interface GetPauseStateMessage {
  type: "GET_PAUSE_STATE";
}

export interface TriggerBackfillMessage {
  type: "TRIGGER_BACKFILL";
  payload: {
    maxUrls: number;
    daysBack: number;
  };
}

export interface UpdateBlocklistMessage {
  type: "UPDATE_BLOCKLIST";
  payload: {
    action: "block" | "unblock";
    domain: string;
  };
}

export interface GetBlocklistMessage {
  type: "GET_BLOCKLIST";
}

export interface SaveLLMConfigMessage {
  type: "SAVE_LLM_CONFIG";
  payload: {
    provider: "groq" | "gemini" | "ollama";
    apiKey: string;
    model: string;
  };
}

export interface GetLLMConfigMessage {
  type: "GET_LLM_CONFIG";
}

// ─── Union Type ──────────────────────────────────────────────────────────

export type ExtensionMessage =
  | PageCapturedMessage
  | EmbedTextMessage
  | EmbedResponseMessage
  | QueryMessage
  | QueryResponseMessage
  | GetDocumentsMessage
  | GetStatsMessage
  | DeleteDocumentMessage
  | WipeDatabaseMessage
  | TogglePauseMessage
  | GetPauseStateMessage
  | TriggerBackfillMessage
  | UpdateBlocklistMessage
  | GetBlocklistMessage
  | SaveLLMConfigMessage
  | GetLLMConfigMessage;
