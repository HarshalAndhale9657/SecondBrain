/**
 * PGlite Database — local PostgreSQL with pgvector for vector storage.
 *
 * Runs a full PostgreSQL engine compiled to WebAssembly, persisted via IndexedDB.
 * Supports HNSW-indexed vector similarity search for sub-millisecond retrieval
 * even at scale.
 *
 * IMPORTANT: PGlite's IDB persistence requires the instance to be properly
 * closed to flush the Emscripten filesystem to IndexedDB. Since Chrome MV3
 * kills service workers after ~30s idle WITHOUT firing any cleanup events,
 * we must close+reopen after every write batch to guarantee persistence.
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

/**
 * PGlite needs IndexedDB for persistence. Service Workers have indexedDB
 * but NOT window.document, so we check for indexedDB directly.
 */
const hasIndexedDB = typeof indexedDB !== "undefined";
const DB_NAME = hasIndexedDB ? "idb://second-brain-db" : "memory://";
const EMBEDDING_DIM = 384;

/** Singleton database instance. */
let db: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

/**
 * Initialize the PGlite database with pgvector extension.
 * Creates schema on first run; reuses existing data on subsequent loads.
 */
async function initDatabase(): Promise<PGlite> {
  const instance = new PGlite(DB_NAME, {
    extensions: { vector },
  });

  await instance.waitReady;

  // Enable pgvector extension
  await instance.exec("CREATE EXTENSION IF NOT EXISTS vector;");

  // Create schema
  await instance.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      doc_id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      text_content TEXT NOT NULL,
      excerpt TEXT,
      byline TEXT,
      simhash_hi INTEGER NOT NULL,
      simhash_lo INTEGER NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_visited TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_backfill BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id BIGSERIAL PRIMARY KEY,
      doc_id BIGINT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIM}),
      source_url TEXT NOT NULL,
      document_title TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dedup_flags (
      doc_id BIGINT PRIMARY KEY REFERENCES documents(doc_id) ON DELETE CASCADE,
      collapse_with BIGINT REFERENCES documents(doc_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);
    CREATE INDEX IF NOT EXISTS idx_documents_simhash ON documents(simhash_hi, simhash_lo);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
  `);

  // Create HNSW index for vector search (idempotent)
  try {
    await instance.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
        ON chunks USING hnsw (embedding vector_cosine_ops);
    `);
  } catch {
    console.warn("[SecondBrain] HNSW index creation deferred.");
  }

  return instance;
}

/**
 * Get a live database connection. Re-opens if closed.
 */
export async function getDatabase(): Promise<PGlite> {
  if (db) {
    try {
      await db.query("SELECT 1");
      return db;
    } catch {
      console.warn("[SecondBrain] DB connection stale, reinitializing...");
      db = null;
      initPromise = null;
    }
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const instance = await initDatabase();
      db = instance;
      console.debug("[SecondBrain] PGlite initialized, DB_NAME:", DB_NAME);
      return instance;
    } catch (err) {
      db = null;
      initPromise = null;
      console.error("[SecondBrain] PGlite init failed:", err);
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Close the database to flush all data to IndexedDB.
 * Must be called after write operations to ensure persistence
 * before Chrome kills the service worker.
 */
export async function flushDatabase(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch {
      // Already closed or errored
    }
    db = null;
    initPromise = null;
  }
}

// ─── Document Operations ─────────────────────────────────────────────────

export interface DocumentRecord {
  doc_id: number;
  url: string;
  title: string;
  text_content: string;
  excerpt: string | null;
  byline: string | null;
  simhash_hi: number;
  simhash_lo: number;
  captured_at: string;
  last_visited: string;
  is_backfill: boolean;
}

/**
 * Insert a new document into the database.
 * Returns the generated doc_id.
 */
export async function insertDocument(
  url: string,
  title: string,
  textContent: string,
  excerpt: string | null,
  byline: string | null,
  simhashHi: number,
  simhashLo: number,
  capturedAt: string,
  isBackfill: boolean = false
): Promise<number> {
  const database = await getDatabase();
  const result = await database.query<{ doc_id: number }>(
    `INSERT INTO documents (url, title, text_content, excerpt, byline, simhash_hi, simhash_lo, captured_at, last_visited, is_backfill)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
     RETURNING doc_id`,
    [url, title, textContent, excerpt, byline, simhashHi, simhashLo, capturedAt, isBackfill]
  );
  return result.rows[0].doc_id;
}

/**
 * Update the last_visited timestamp for an existing document.
 */
export async function updateLastVisited(docId: number): Promise<void> {
  const database = await getDatabase();
  await database.query(
    "UPDATE documents SET last_visited = NOW() WHERE doc_id = $1",
    [docId]
  );
}

/**
 * Get all stored SimHash fingerprints for dedup comparison.
 */
export async function getAllSimHashes(): Promise<
  Array<{ doc_id: number; simhash_hi: number; simhash_lo: number }>
> {
  const database = await getDatabase();
  const result = await database.query<{
    doc_id: number;
    simhash_hi: number;
    simhash_lo: number;
  }>("SELECT doc_id, simhash_hi, simhash_lo FROM documents");
  return result.rows;
}

/**
 * Delete a document and all its chunks (cascading).
 */
export async function deleteDocument(docId: number): Promise<void> {
  const database = await getDatabase();
  await database.query("DELETE FROM documents WHERE doc_id = $1", [docId]);
}

/**
 * Get all documents for the index browser.
 */
export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const database = await getDatabase();
  const result = await database.query<DocumentRecord>(
    "SELECT * FROM documents ORDER BY last_visited DESC"
  );
  return result.rows;
}

/**
 * Get document count and total chunks for stats display.
 */
export async function getIndexStats(): Promise<{
  documentCount: number;
  chunkCount: number;
}> {
  const database = await getDatabase();
  const docs = await database.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM documents"
  );
  const chunks = await database.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM chunks"
  );
  return {
    documentCount: parseInt(docs.rows[0].count, 10),
    chunkCount: parseInt(chunks.rows[0].count, 10),
  };
}

// ─── Chunk Operations ────────────────────────────────────────────────────

export interface ChunkRecord {
  chunk_id: number;
  doc_id: number;
  chunk_index: number;
  chunk_text: string;
  source_url: string;
  document_title: string;
  captured_at: string;
}

/**
 * Insert a chunk with its embedding vector.
 */
export async function insertChunk(
  docId: number,
  chunkIndex: number,
  chunkText: string,
  embedding: Float32Array,
  sourceUrl: string,
  documentTitle: string,
  capturedAt: string
): Promise<number> {
  const database = await getDatabase();

  // Convert Float32Array to pgvector format string: [0.1, 0.2, ...]
  const vectorStr = `[${Array.from(embedding).join(",")}]`;

  const result = await database.query<{ chunk_id: number }>(
    `INSERT INTO chunks (doc_id, chunk_index, chunk_text, embedding, source_url, document_title, captured_at)
     VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
     RETURNING chunk_id`,
    [docId, chunkIndex, chunkText, vectorStr, sourceUrl, documentTitle, capturedAt]
  );
  return result.rows[0].chunk_id;
}

// ─── Dedup Flag Operations ───────────────────────────────────────────────

/**
 * Flag a document as a near-duplicate that should collapse with another.
 */
export async function flagNearDuplicate(
  docId: number,
  collapseWithDocId: number
): Promise<void> {
  const database = await getDatabase();
  await database.query(
    `INSERT INTO dedup_flags (doc_id, collapse_with)
     VALUES ($1, $2)
     ON CONFLICT (doc_id) DO UPDATE SET collapse_with = $2`,
    [docId, collapseWithDocId]
  );
}

// ─── Vector Search ───────────────────────────────────────────────────────

export interface SearchResult {
  chunk_id: number;
  doc_id: number;
  chunk_text: string;
  source_url: string;
  document_title: string;
  captured_at: string;
  similarity: number;
}

/**
 * Perform cosine similarity search against stored chunk embeddings.
 * Returns top-K results ordered by similarity (descending).
 */
export async function vectorSearch(
  queryEmbedding: Float32Array,
  topK: number = 20,
  dateFrom?: string,
  dateTo?: string
): Promise<SearchResult[]> {
  const database = await getDatabase();
  const vectorStr = `[${Array.from(queryEmbedding).join(",")}]`;

  let query = `
    SELECT
      c.chunk_id,
      c.doc_id,
      c.chunk_text,
      c.source_url,
      c.document_title,
      c.captured_at,
      1 - (c.embedding <=> $1::vector) AS similarity
    FROM chunks c
    LEFT JOIN dedup_flags df ON c.doc_id = df.doc_id
  `;

  const params: (string | number)[] = [vectorStr];
  const conditions: string[] = [];

  // Exclude collapsed near-duplicates (only keep the target)
  conditions.push("df.doc_id IS NULL");

  // Date range filtering for time-scoped queries
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`c.captured_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`c.captured_at <= $${params.length}::timestamptz`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  params.push(topK);
  query += ` ORDER BY similarity DESC LIMIT $${params.length}`;

  const result = await database.query<SearchResult>(query, params);
  return result.rows;
}

// ─── Database Maintenance ────────────────────────────────────────────────

/**
 * Wipe the entire database — delete all documents, chunks, and flags.
 */
export async function wipeDatabase(): Promise<void> {
  const database = await getDatabase();
  await database.exec(`
    DELETE FROM dedup_flags;
    DELETE FROM chunks;
    DELETE FROM documents;
  `);
}
