/**
 * Readability Wrapper — extracts clean content from raw DOM.
 *
 * Two-tier strategy:
 * 1. Primary: Mozilla Readability.js for article-like pages (best quality)
 * 2. Fallback: DOM text extraction for non-article pages (landing pages,
 *    dashboards, apps, search results, etc.)
 *
 * This ensures ALL browsable pages contribute to the index, not just articles.
 */

import { Readability, isProbablyReaderable } from "@mozilla/readability";

export interface ExtractedContent {
  title: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
}

/** Minimum character count to consider extracted text worth indexing. */
const MIN_CONTENT_LENGTH = 150;

/**
 * Tags whose text content should be excluded from fallback extraction.
 * These contain navigation, scripts, or UI chrome — not page content.
 */
const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "NAV",
  "HEADER",
  "FOOTER",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "CODE",
  "PRE",
]);

/**
 * Preflight check — determines if the current page likely contains
 * a readable article (as opposed to a dashboard, app, or image gallery).
 */
export function isPageReadable(doc: Document): boolean {
  return isProbablyReaderable(doc, {
    minContentLength: 140,
    minScore: 20,
  });
}

/**
 * Fallback text extraction — walks the visible DOM and collects text
 * from content-bearing elements, skipping nav/chrome/script elements.
 *
 * Used when Readability deems the page non-article (landing pages,
 * search results, dashboards, etc.).
 */
function extractFallbackText(doc: Document): string {
  const textParts: string[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;

      // Skip hidden elements and excluded tags
      if (EXCLUDED_TAGS.has(el.tagName)) return;

      // Skip elements with aria-hidden or display:none
      if (
        el.getAttribute("aria-hidden") === "true" ||
        el.getAttribute("role") === "navigation"
      ) {
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim();
      if (text.length > 2) {
        textParts.push(text);
      }
      return;
    }

    // Recurse into children
    for (const child of node.childNodes) {
      walk(child);
    }
  }

  const body = doc.body;
  if (body) {
    walk(body);
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Extract content from the current document.
 *
 * Strategy:
 * 1. Try Readability.js first — produces highest quality extraction for articles
 * 2. Fall back to DOM text extraction for non-article pages
 * 3. Returns null only if the page has truly negligible text content
 */
export function extractContent(doc: Document): ExtractedContent | null {
  // ─── Tier 1: Try Readability.js for article pages ──────────────────

  if (isPageReadable(doc)) {
    // Deep clone to prevent DOM mutation of the live page
    const clonedDoc = doc.cloneNode(true) as Document;

    const reader = new Readability(clonedDoc, {
      charThreshold: MIN_CONTENT_LENGTH,
    });

    const article = reader.parse();

    if (article && article.textContent) {
      const trimmedText = article.textContent.trim();
      if (trimmedText.length >= MIN_CONTENT_LENGTH) {
        return {
          title: article.title || doc.title || "Untitled",
          textContent: trimmedText,
          excerpt: article.excerpt || trimmedText.slice(0, 200),
          byline: article.byline || null,
          siteName: article.siteName || null,
          length: trimmedText.length,
        };
      }
    }
  }

  // ─── Tier 2: Fallback DOM extraction for non-article pages ─────────

  const fallbackText = extractFallbackText(doc);

  if (fallbackText.length < MIN_CONTENT_LENGTH) {
    return null; // Page has too little text to be useful
  }

  // Truncate very large pages (e.g. sprawling SPAs) to avoid
  // sending megabytes of text through the pipeline
  const maxLength = 15_000;
  const text =
    fallbackText.length > maxLength
      ? fallbackText.slice(0, maxLength)
      : fallbackText;

  return {
    title: doc.title || "Untitled",
    textContent: text,
    excerpt: text.slice(0, 200),
    byline: null,
    siteName: null,
    length: text.length,
  };
}
