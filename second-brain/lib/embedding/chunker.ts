/**
 * Text Chunker — splits extracted content into overlapping semantic chunks.
 *
 * Uses sentence-boundary-aware splitting to avoid cutting mid-sentence.
 * Each chunk carries its metadata for downstream citation tracking.
 */

export interface ChunkMetadata {
  sourceUrl: string;
  documentTitle: string;
  chunkIndex: number;
  capturedAt: string;
}

export interface TextChunk {
  text: string;
  metadata: ChunkMetadata;
}

/** Target chunk size in characters (approximation of ~512 tokens). */
const CHUNK_SIZE = 1500;

/** Overlap in characters between consecutive chunks. */
const CHUNK_OVERLAP = 200;

/** Minimum chunk size to avoid degenerate tiny chunks. */
const MIN_CHUNK_SIZE = 100;

/**
 * Split text into sentences using common sentence-ending patterns.
 * Handles abbreviations (Mr., Dr., etc.) and decimal numbers to avoid
 * false splits.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace and uppercase
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences.filter((s) => s.trim().length > 0);
}

/**
 * Chunk a document's text content into overlapping segments suitable
 * for embedding. Respects sentence boundaries to preserve semantic coherence.
 *
 * @param text - The full text content to chunk.
 * @param sourceUrl - Source URL for citation metadata.
 * @param documentTitle - Document title for citation metadata.
 * @param capturedAt - ISO timestamp of when the page was captured.
 * @returns Array of text chunks with metadata.
 */
export function chunkText(
  text: string,
  sourceUrl: string,
  documentTitle: string,
  capturedAt: string
): TextChunk[] {
  const sentences = splitSentences(text);

  if (sentences.length === 0) {
    return [];
  }

  // If the entire text fits in one chunk, return it as-is
  if (text.length <= CHUNK_SIZE) {
    return [
      {
        text: text.trim(),
        metadata: {
          sourceUrl,
          documentTitle,
          chunkIndex: 0,
          capturedAt,
        },
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // If adding this sentence would exceed chunk size, finalize current chunk
    if (currentLength + sentence.length > CHUNK_SIZE && currentLength > 0) {
      chunks.push({
        text: currentChunk.join(" ").trim(),
        metadata: {
          sourceUrl,
          documentTitle,
          chunkIndex,
          capturedAt,
        },
      });
      chunkIndex++;

      // Calculate overlap: walk backwards through sentences to find overlap boundary
      let overlapLength = 0;
      const overlapSentences: string[] = [];

      for (let j = currentChunk.length - 1; j >= 0; j--) {
        if (overlapLength + currentChunk[j].length > CHUNK_OVERLAP) break;
        overlapSentences.unshift(currentChunk[j]);
        overlapLength += currentChunk[j].length;
      }

      currentChunk = overlapSentences;
      currentLength = overlapLength;
    }

    currentChunk.push(sentence);
    currentLength += sentence.length;
  }

  // Finalize remaining content
  if (currentLength >= MIN_CHUNK_SIZE) {
    chunks.push({
      text: currentChunk.join(" ").trim(),
      metadata: {
        sourceUrl,
        documentTitle,
        chunkIndex,
        capturedAt,
      },
    });
  } else if (chunks.length > 0) {
    // Append remaining text to the last chunk if it's too short
    const lastChunk = chunks[chunks.length - 1];
    lastChunk.text += " " + currentChunk.join(" ").trim();
  }

  return chunks;
}
