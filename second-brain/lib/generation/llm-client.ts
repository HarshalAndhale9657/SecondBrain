/**
 * LLM Client — switchable client for Groq, Gemini, and Ollama.
 *
 * Handles answer generation from retrieved context chunks.
 * Includes retry logic, request timeouts, and real citation parsing.
 */

export type LLMProvider = "groq" | "gemini" | "ollama";

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface GenerationRequest {
  query: string;
  contextChunks: Array<{
    text: string;
    sourceUrl: string;
    documentTitle: string;
    capturedAt: string;
  }>;
}

export interface GenerationResponse {
  answer: string;
  citations: Array<{
    index: number;
    url: string;
    title: string;
  }>;
}

const STORAGE_KEY = "llm_config";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_500;

const DEFAULT_CONFIGS: Record<LLMProvider, Partial<LLMConfig>> = {
  groq: {
    model: "llama-3.1-8b-instant",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  gemini: {
    model: "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  ollama: {
    model: "llama3.1",
    baseUrl: "http://localhost:11434",
  },
};

/**
 * Build-time API key injected from .env via Vite.
 * Falls back to empty string if not set.
 */
const BUILD_TIME_GROQ_KEY: string = import.meta.env.VITE_GROQ_API_KEY || "";

/**
 * Load LLM configuration from chrome.storage.local.
 * Falls back to the build-time Groq API key if no key is stored.
 */
export async function loadLLMConfig(): Promise<LLMConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];

  if (stored && stored.apiKey) {
    return stored;
  }

  // Return defaults with build-time key
  const defaultConfig: LLMConfig = {
    provider: "groq",
    apiKey: stored?.apiKey || BUILD_TIME_GROQ_KEY,
    model: stored?.model || "llama-3.1-8b-instant",
    baseUrl: stored?.baseUrl || "https://api.groq.com/openai/v1",
  };

  return defaultConfig;
}

/**
 * Save LLM configuration to chrome.storage.local.
 */
export async function saveLLMConfig(config: LLMConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/**
 * Build the system prompt that enforces grounded generation.
 * The LLM must only synthesize from provided chunks and never
 * use its training knowledge.
 */
function buildSystemPrompt(): string {
  return `You are a concise personal browsing assistant. Answer questions using ONLY the context chunks from the user's history.

CONTEXT FORMAT (internal — never expose these labels to the user):
Each chunk has [SOURCE], [TITLE], and [READ ON] metadata.

RESPONSE RULES:
1. Answer ONLY from the provided context. Never use training knowledge.
2. Be concise and conversational — 1-3 sentences for simple questions.
3. If the answer is not in the context, respond exactly: "Not in your history."
4. Cite sources with [1], [2] etc. at the end of the relevant sentence. Do NOT write a reference list — the UI handles that.
5. NEVER mention "chunks", "context", "Chunk 1", "[READ ON]", "[SOURCE]", or other internal labels. Speak naturally as if you know the information.
6. For "what did I read/visit?" questions — just list the page titles naturally, e.g. "You recently visited **PageTitle** on site.com."
7. For "last visited" questions — use the most recent timestamp to identify the page, then answer: "Your most recent page was **Title** (site.com)."
8. Only cite sources you actually used. Never cite all sources.`;
}

/**
 * Format retrieved context chunks into the prompt context block.
 */
function formatContext(
  chunks: GenerationRequest["contextChunks"]
): string {
  return chunks
    .map(
      (chunk, i) =>
        `--- Chunk ${i + 1} ---
[SOURCE]: ${chunk.sourceUrl}
[TITLE]: ${chunk.documentTitle}
[READ ON]: ${chunk.capturedAt}

${chunk.text}`
    )
    .join("\n\n");
}

/**
 * Parse citation references like [1], [2] from the LLM's raw output
 * and return only the context chunks that were actually cited.
 */
function extractCitedReferences(
  rawAnswer: string,
  contextChunks: GenerationRequest["contextChunks"]
): Array<{ index: number; url: string; title: string }> {
  const citedIndices = new Set<number>();
  const citationPattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(rawAnswer)) !== null) {
    const idx = parseInt(match[1], 10);
    if (idx >= 1 && idx <= contextChunks.length) {
      citedIndices.add(idx);
    }
  }

  // If the LLM cited nothing explicitly, fall back to all chunks
  // (graceful degradation for models that don't follow citation format)
  if (citedIndices.size === 0) {
    return contextChunks.map((chunk, i) => ({
      index: i + 1,
      url: chunk.sourceUrl,
      title: chunk.documentTitle,
    }));
  }

  return Array.from(citedIndices)
    .sort((a, b) => a - b)
    .map((idx) => ({
      index: idx,
      url: contextChunks[idx - 1].sourceUrl,
      title: contextChunks[idx - 1].documentTitle,
    }));
}

/**
 * Fetch with a timeout. Throws if the request takes longer than `timeoutMs`.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retry a function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_BASE_DELAY_MS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on auth errors or bad requests
      if (lastError.message.includes("401") || lastError.message.includes("400")) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `[SecondBrain] LLM request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
          lastError.message
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}

/**
 * Generate an answer using the Groq API (OpenAI-compatible endpoint).
 */
async function generateGroq(
  config: LLMConfig,
  request: GenerationRequest
): Promise<string> {
  const response = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `Context from my browsing history:\n\n${formatContext(request.contextChunks)}\n\n---\n\nQuestion: ${request.query}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Generate an answer using the Gemini API.
 */
async function generateGemini(
  config: LLMConfig,
  request: GenerationRequest
): Promise<string> {
  const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemPrompt() }],
      },
      contents: [
        {
          parts: [
            {
              text: `Context from my browsing history:\n\n${formatContext(request.contextChunks)}\n\n---\n\nQuestion: ${request.query}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

/**
 * Generate an answer using a local Ollama instance.
 */
async function generateOllama(
  config: LLMConfig,
  request: GenerationRequest
): Promise<string> {
  const response = await fetchWithTimeout(
    `${config.baseUrl}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `Context from my browsing history:\n\n${formatContext(request.contextChunks)}\n\n---\n\nQuestion: ${request.query}`,
          },
        ],
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
    },
    60_000 // Ollama is local, give it more time
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.message.content;
}

/**
 * Generate an answer from retrieved context using the configured LLM.
 * Routes to the appropriate provider based on stored configuration.
 * Includes retry logic for transient failures.
 */
export async function generateAnswer(
  request: GenerationRequest
): Promise<GenerationResponse> {
  const config = await loadLLMConfig();

  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(
      `No API key configured for ${config.provider}. Set it in the extension settings.`
    );
  }

  const rawAnswer = await withRetry(async () => {
    switch (config.provider) {
      case "groq":
        return generateGroq(config, request);
      case "gemini":
        return generateGemini(config, request);
      case "ollama":
        return generateOllama(config, request);
      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  });

  // Extract only the citations the LLM actually referenced
  const citations = extractCitedReferences(rawAnswer, request.contextChunks);

  return {
    answer: rawAnswer,
    citations,
  };
}

/**
 * Get the default config for a provider (used by settings UI).
 */
export function getDefaultConfig(provider: LLMProvider): Partial<LLMConfig> {
  return DEFAULT_CONFIGS[provider];
}
