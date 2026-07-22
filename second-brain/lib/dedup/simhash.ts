/**
 * SimHash — 64-bit Locality-Sensitive Hashing for near-duplicate detection.
 *
 * Unlike cryptographic hashes, SimHash produces similar hashes for similar inputs.
 * The Hamming distance between two SimHash fingerprints directly measures document
 * similarity: small distance = near-duplicate, large distance = distinct content.
 *
 * Implementation uses FNV-1a for per-shingle hashing and BigInt for 64-bit operations
 * to avoid JavaScript's 32-bit integer truncation in bitwise operations.
 */

/** FNV-1a 64-bit offset basis and prime (as BigInt). */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Number of words per shingle for tokenization. */
const SHINGLE_SIZE = 3;

/**
 * Compute a 64-bit FNV-1a hash of a string.
 * Returns a BigInt in the range [0, 2^64).
 */
function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/**
 * Tokenize text into overlapping word n-grams (shingles).
 * Normalizes text to lowercase and strips non-alphanumeric characters.
 */
function tokenizeToShingles(text: string, size: number = SHINGLE_SIZE): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length < size) {
    return [words.join(" ")];
  }

  const shingles: string[] = [];
  for (let i = 0; i <= words.length - size; i++) {
    shingles.push(words.slice(i, i + size).join(" "));
  }
  return shingles;
}

/**
 * Compute the 64-bit SimHash fingerprint of a text document.
 *
 * Algorithm:
 * 1. Tokenize text into 3-word shingles
 * 2. Hash each shingle with FNV-1a to produce a 64-bit hash
 * 3. For each hash, iterate through all 64 bit positions:
 *    - If bit is 1, add weight (+1) to that position in the accumulator
 *    - If bit is 0, subtract weight (-1) from that position
 * 4. Final fingerprint: for each position, set bit to 1 if accumulator > 0, else 0
 *
 * Returns the fingerprint as a BigInt.
 */
export function computeSimHash(text: string): bigint {
  const shingles = tokenizeToShingles(text);

  if (shingles.length === 0) {
    return 0n;
  }

  // 64-dimensional accumulator
  const vector = new Array<number>(64).fill(0);

  for (const shingle of shingles) {
    const hash = fnv1a64(shingle);

    for (let i = 0; i < 64; i++) {
      const bit = (hash >> BigInt(i)) & 1n;
      vector[i] += bit === 1n ? 1 : -1;
    }
  }

  // Construct the final fingerprint
  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (vector[i] > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }

  return fingerprint;
}

/**
 * Compute the Hamming distance between two 64-bit SimHash fingerprints.
 * The distance equals the number of differing bit positions.
 *
 * Uses BigInt XOR to avoid JavaScript's 32-bit integer truncation.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

/**
 * Split a 64-bit BigInt SimHash into two 32-bit integers for storage
 * in standard integer database columns.
 */
export function splitSimHash(hash: bigint): { hi: number; lo: number } {
  return {
    hi: Number((hash >> 32n) & 0xffffffffn),
    lo: Number(hash & 0xffffffffn),
  };
}

/**
 * Reconstruct a 64-bit BigInt SimHash from two 32-bit integer halves.
 */
export function joinSimHash(hi: number, lo: number): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

/** Deduplication decision thresholds. */
export enum DedupAction {
  /** Hamming distance 0-3: >95% similar. Discard, update timestamp only. */
  IDENTICAL = "IDENTICAL",
  /** Hamming distance 4-10: 84-94% similar. Store but collapse during retrieval. */
  NEAR_DUPLICATE = "NEAR_DUPLICATE",
  /** Hamming distance >10: <84% similar. Treat as distinct content. */
  DISTINCT = "DISTINCT",
}

/**
 * Determine the deduplication action based on Hamming distance.
 */
export function classifyDuplicate(distance: number): DedupAction {
  if (distance <= 3) return DedupAction.IDENTICAL;
  if (distance <= 10) return DedupAction.NEAR_DUPLICATE;
  return DedupAction.DISTINCT;
}
