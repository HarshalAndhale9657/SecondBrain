/**
 * Content Script — DOM harvester injected into every allowed page.
 *
 * Responsibilities:
 * 1. Detect page load and SPA navigations
 * 2. Extract readable content via Readability.js (on a cloned DOM)
 * 3. Clean URLs (strip tracking parameters)
 * 4. Send extracted content to the Service Worker for processing
 *
 * Operates in Chrome's "Isolated World" — its variables and message channels
 * are invisible to the host page's JavaScript.
 */

import { extractContent } from "@/lib/capture/readability";
import { initSPADetector, waitForDOMSettle } from "@/lib/capture/spa-detector";
import { cleanUrl } from "@/lib/capture/url-cleaner";
import type { PageCapturedMessage } from "@/lib/messages";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    let lastCapturedUrl: string | null = null;

    /**
     * Attempt to capture the current page's content and send it
     * to the Service Worker for indexing.
     *
     * Checks pause state locally via chrome.storage.local before
     * doing expensive DOM extraction to save CPU/memory.
     */
    async function capturePage(): Promise<void> {
      const currentUrl = cleanUrl(location.href);

      // Skip if we already captured this URL in this tab session
      if (currentUrl === lastCapturedUrl) return;

      // Skip non-http pages (chrome://, about:, etc.)
      if (!location.protocol.startsWith("http")) return;

      // Early pause check — avoids cloning the DOM when capture is paused
      try {
        const result = await chrome.storage.local.get("blocklist_config");
        const config = result["blocklist_config"];
        if (config?.isPaused) return;
      } catch {
        // If storage is unavailable, proceed with capture
      }

      const content = extractContent(document);
      if (!content) return;

      lastCapturedUrl = currentUrl;

      const message: PageCapturedMessage = {
        type: "PAGE_CAPTURED",
        payload: {
          url: currentUrl,
          title: content.title,
          textContent: content.textContent,
          excerpt: content.excerpt,
          byline: content.byline,
          capturedAt: new Date().toISOString(),
        },
      };

      chrome.runtime.sendMessage(message).catch((err) => {
        // Service worker may not be active; this is expected
        console.debug("[SecondBrain] Message send failed:", err.message);
      });
    }

    // ─── Initial Page Load ─────────────────────────────────────────────

    // Wait for DOM to be fully settled before first capture
    waitForDOMSettle(() => {
      capturePage();
    });

    // ─── SPA Navigation Monitoring ─────────────────────────────────────

    initSPADetector((newUrl: string) => {
      lastCapturedUrl = null; // Reset so new URL triggers capture
      capturePage();
    });

    // ─── Listen for Service Worker signals ──────────────────────────────

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "CAPTURE_CURRENT_PAGE") {
        lastCapturedUrl = null;
        waitForDOMSettle(() => {
          capturePage();
          sendResponse({ success: true });
        });
        return true; // Async response
      }
    });
  },
});
