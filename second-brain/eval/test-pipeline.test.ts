import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chunkText } from "../lib/embedding/chunker";
import { computeSimHash, hammingDistance } from "../lib/dedup/simhash";
import { parseTimeScope } from "../lib/retrieval/search";
import { getDatabase, insertChunk, insertDocument, vectorSearch, wipeDatabase } from "../lib/storage/pglite-db";

describe("Pipeline Tests", () => {
  beforeAll(async () => {
    // We mocked chrome in the test setup.
    await wipeDatabase();
  });

  afterAll(async () => {
    await wipeDatabase();
  });

  it("Chunking should split text intelligently", () => {
    const text = "This is a sentence. ".repeat(50); // 1000 characters
    const chunks = chunkText(text, "http://test", "Title", new Date().toISOString());
    
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1600); // 1500 is target, allow some buffer
    }
  });

  it("SimHash should flag near duplicates", () => {
    const text1 = "The quick brown fox jumps over the lazy dog.";
    const text2 = "The quick brown fox jumped over the lazy dog!";
    const text3 = "React is a JavaScript library for building user interfaces.";

    const hash1 = computeSimHash(text1);
    const hash2 = computeSimHash(text2);
    const hash3 = computeSimHash(text3);

    const dist12 = hammingDistance(hash1, hash2);
    const dist13 = hammingDistance(hash1, hash3);

    expect(dist12).toBeLessThan(25); // Minor edits should have smaller distance than completely different topics
    expect(dist13).toBeGreaterThan(25); // Should be very different
  });

  it("Time parsing should extract relative dates", () => {
    const timeScope = parseTimeScope("what did I read last week?");
    expect(timeScope).not.toBeNull();
    if (timeScope) {
      expect(timeScope.from).toBeDefined();
      expect(timeScope.to).toBeDefined();
    }
  });

  it("PGlite should store and retrieve vector embeddings", async () => {
    const docId = await insertDocument(
      "https://example.com/ai",
      "AI History",
      "Artificial Intelligence history.",
      "AI history",
      "Author",
      123,
      456,
      new Date().toISOString(),
      false
    );

    const embedding = new Float32Array(384).fill(0.1);
    await insertChunk(docId, 0, "AI history.", embedding, "https://example.com/ai", "AI History", new Date().toISOString());

    // exact match vector
    const queryVector = new Float32Array(384).fill(0.1);
    const results = await vectorSearch(queryVector, 5);
    
    expect(results.length).toBe(1);
    expect(results[0].chunk_text).toBe("AI history.");
    // exact match cosine similarity is ~1
    expect(results[0].similarity).toBeGreaterThan(0.99);
  });
});
