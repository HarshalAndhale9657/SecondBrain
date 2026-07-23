/**
 * Retrieval System — hybrid vector search with temporal decay and MMR.
 *
 * Implements the full retrieval pipeline:
 * 1. Vector similarity search (cosine distance via PGlite/pgvector)
 * 2. Temporal decay re-ranking (exponential decay favoring recent reads)
 * 3. Time-scoped query parsing (extracting date ranges from natural language)
 * 4. Maximal Marginal Relevance diversification
 * 5. Negative rejection (confidence threshold for "not in history")
 */

import type { SearchResult } from "../storage/pglite-db";

// ─── Temporal Decay ──────────────────────────────────────────────────────

/**
 * Half-life of browsing relevance in seconds (7 days).
 * Documents read 7 days ago get half the temporal weight of documents read now.
 */
const HALF_LIFE_SECONDS = 7 * 24 * 3600;
const DECAY_CONSTANT = Math.log(2) / HALF_LIFE_SECONDS;

/**
 * Apply exponential temporal decay to search results.
 * Final score = similarity * exp(-lambda * delta_t)
 *
 * Documents read recently get a multiplicative boost when semantic
 * similarity is comparable. This prevents obsolete content from
 * outranking recent, equally relevant reads.
 */
export function applyTemporalDecay(
  results: SearchResult[],
  queryTime: Date = new Date()
): Array<SearchResult & { finalScore: number }> {
  return results.map((result) => {
    const capturedAt = new Date(result.captured_at);
    const deltaSeconds = (queryTime.getTime() - capturedAt.getTime()) / 1000;
    const decayFactor = Math.exp(-DECAY_CONSTANT * Math.max(0, deltaSeconds));
    const finalScore = result.similarity * decayFactor;

    return { ...result, finalScore };
  });
}

// ─── Time-Scoped Query Parsing ───────────────────────────────────────────

export interface DateRange {
  from: string; // ISO 8601
  to: string; // ISO 8601
}

/**
 * Extract date range from natural language time expressions in queries.
 * Returns null if no temporal markers are detected.
 *
 * Supports: "today", "yesterday", "this week", "last week",
 * "this month", "last month", "N days ago"
 */
export function parseTimeScope(query: string): DateRange | null {
  const now = new Date();
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("today")) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }

  if (lowerQuery.includes("yesterday")) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  if (lowerQuery.includes("this week")) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }

  if (lowerQuery.includes("last week")) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  if (lowerQuery.includes("this month")) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString(), to: now.toISOString() };
  }

  if (lowerQuery.includes("last month")) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  // Match "N days ago" pattern
  const daysAgoMatch = lowerQuery.match(/(\d+)\s+days?\s+ago/);
  if (daysAgoMatch) {
    const daysAgo = parseInt(daysAgoMatch[1], 10);
    const start = new Date(now);
    start.setDate(start.getDate() - daysAgo);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }

  return null;
}

// ─── Maximal Marginal Relevance ──────────────────────────────────────────

/**
 * Compute cosine similarity between two embedding vectors.
 * Both vectors are assumed to be L2-normalized.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Apply Maximal Marginal Relevance to select a diverse subset of results.
 *
 * MMR balances relevance (similarity to query) and diversity (dissimilarity
 * to already-selected results). This prevents returning 5 chunks from the
 * same page when the user needs cross-document synthesis.
 *
 * @param results - Candidate results with similarity scores.
 * @param embeddings - Embedding vectors for each candidate (parallel array).
 * @param topN - Number of results to select.
 * @param lambda - Tradeoff parameter: 1.0 = pure relevance, 0.0 = pure diversity.
 */
export function applyMMR(
  results: Array<SearchResult & { finalScore: number }>,
  embeddings: number[][],
  topN: number = 5,
  lambda: number = 0.5
): Array<SearchResult & { finalScore: number }> {
  if (results.length <= topN) return results;

  const selected: number[] = [];
  const candidates = new Set(results.map((_, i) => i));

  // Greedily select top-N by MMR score
  for (let step = 0; step < topN; step++) {
    let bestIndex = -1;
    let bestMMR = -Infinity;

    for (const i of candidates) {
      const relevance = results[i].finalScore;

      // Max similarity to any already-selected result
      let maxSimToSelected = 0;
      for (const j of selected) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        maxSimToSelected = Math.max(maxSimToSelected, sim);
      }

      const mmrScore =
        lambda * relevance - (1 - lambda) * maxSimToSelected;

      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      selected.push(bestIndex);
      candidates.delete(bestIndex);
    }
  }

  return selected.map((i) => results[i]);
}

// ─── Negative Rejection ──────────────────────────────────────────────────

/**
 * Minimum cosine similarity threshold for considering a result relevant.
 * If no result exceeds this threshold, the system returns "Not in your history."
 *
 * Set conservatively low (0.25) to avoid false negatives on small indices
 * where the embedding space is sparse. The LLM's grounding rules provide
 * the second safety net against hallucination.
 */
const RELEVANCE_THRESHOLD = 0.25;

/**
 * Determine if the search results indicate the query topic is absent
 * from the user's browsing history.
 *
 * Returns true if the system should respond with "Not in your history."
 */
export function shouldRejectAsAbsent(results: SearchResult[]): boolean {
  if (results.length === 0) return true;

  const maxSimilarity = Math.max(...results.map((r) => r.similarity));
  return maxSimilarity < RELEVANCE_THRESHOLD;
}
