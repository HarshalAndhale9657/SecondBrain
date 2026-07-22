/**
 * LLM Client — switchable client for Groq, Gemini, and Ollama.
 *
 * Handles answer generation from retrieved context chunks.
 * Supports streaming for responsive UI updates.
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
  return `You are a personal browsing history assistant. Your role is to answer the user's questions using ONLY the context chunks provided below from their browsing history.

Each context chunk includes:
- [SOURCE]: The URL where the content was read
- [READ ON]: The date/time the page was captured

RULES (strict):
1. Answer ONLY from the provided context chunks. Do not use your training knowledge.
2. If the context does not contain sufficient information to answer the question, respond with exactly: "Not in your history."
3. Be concise and direct. Cite your sources.
4. End your answer with numbered references in this format:
   [1] Title — URL
5. For time-scoped questions ("last week", "yesterday"), prioritize chunks matching that time range.
6. If chunks from multiple sources are relevant, synthesize them and cite all contributing sources.
7. Never fabricate, guess, or extrapolate beyond what the context explicitly states.`;
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
 * Generate an answer using the Groq API (OpenAI-compatible endpoint).
 */
async function generateGroq(
  config: LLMConfig,
  request: GenerationRequest
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  });

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

  const response = await fetch(url, {
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
  const response = await fetch(`${config.baseUrl}/api/chat`, {
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
  });

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

  let rawAnswer: string;

  switch (config.provider) {
    case "groq":
      rawAnswer = await generateGroq(config, request);
      break;
    case "gemini":
      rawAnswer = await generateGemini(config, request);
      break;
    case "ollama":
      rawAnswer = await generateOllama(config, request);
      break;
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }

  // Extract citations from the answer
  const citations = request.contextChunks.map((chunk, i) => ({
    index: i + 1,
    url: chunk.sourceUrl,
    title: chunk.documentTitle,
  }));

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
