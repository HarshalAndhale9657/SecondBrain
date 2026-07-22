/**
 * Readability Wrapper — extracts clean article content from raw DOM.
 *
 * Uses Mozilla's Readability.js to strip navigation, ads, and boilerplate
 * down to the primary content. Operates on a deep clone to avoid mutating
 * the live page.
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
const MIN_CONTENT_LENGTH = 200;

/**
 * Preflight check — determines if the current page likely contains
 * a readable article (as opposed to a dashboard, app, or image gallery).
 *
 * Returns false for pages that would produce low-quality extractions.
 */
export function isPageReadable(doc: Document): boolean {
  return isProbablyReaderable(doc, {
    minContentLength: 140,
    minScore: 20,
  });
}

/**
 * Extract the primary article content from the current document.
 *
 * Clones the DOM to prevent Readability's aggressive mutations from
 * destroying the user's live page. Returns null if the page doesn't
 * contain extractable article content.
 */
export function extractContent(doc: Document): ExtractedContent | null {
  // Preflight: skip non-article pages
  if (!isPageReadable(doc)) {
    return null;
  }

  // Deep clone to prevent DOM mutation of the live page
  const clonedDoc = doc.cloneNode(true) as Document;

  const reader = new Readability(clonedDoc, {
    charThreshold: MIN_CONTENT_LENGTH,
  });

  const article = reader.parse();

  if (!article || !article.textContent) {
    return null;
  }

  // Reject thin content
  const trimmedText = article.textContent.trim();
  if (trimmedText.length < MIN_CONTENT_LENGTH) {
    return null;
  }

  return {
    title: article.title || doc.title || "Untitled",
    textContent: trimmedText,
    excerpt: article.excerpt || trimmedText.slice(0, 200),
    byline: article.byline || null,
    siteName: article.siteName || null,
    length: trimmedText.length,
  };
}
