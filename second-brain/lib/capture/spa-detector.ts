/**
 * SPA Navigation Detector — handles single-page application route changes.
 *
 * SPAs rewrite the DOM without triggering full page loads. This module detects
 * URL changes via the History API and waits for DOM mutations to settle before
 * signaling that content is ready for extraction.
 */

export interface SPADetectorConfig {
  /** Milliseconds to wait after last DOM mutation before considering the page settled. */
  debounceMs: number;
  /** Maximum time to wait for DOM settlement before forcing extraction. */
  maxWaitMs: number;
}

const DEFAULT_CONFIG: SPADetectorConfig = {
  debounceMs: 500,
  maxWaitMs: 5000,
};

type SettleCallback = (url: string) => void;

/**
 * Observes the document body for mutations and invokes the callback
 * once the DOM has stabilized (no mutations for `debounceMs`).
 */
export function waitForDOMSettle(
  callback: () => void,
  config: Partial<SPADetectorConfig> = {}
): void {
  const { debounceMs, maxWaitMs } = { ...DEFAULT_CONFIG, ...config };

  let debounceTimer: ReturnType<typeof setTimeout>;
  const startTime = Date.now();

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);

    // Enforce maximum wait time
    if (Date.now() - startTime >= maxWaitMs) {
      observer.disconnect();
      callback();
      return;
    }

    debounceTimer = setTimeout(() => {
      observer.disconnect();
      callback();
    }, debounceMs);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Fallback: if no mutations occur at all, fire after debounceMs
  debounceTimer = setTimeout(() => {
    observer.disconnect();
    callback();
  }, debounceMs);
}

/**
 * Initializes SPA navigation monitoring. Listens for:
 * 1. History pushState/replaceState interceptions
 * 2. popstate events (back/forward navigation)
 *
 * On each detected navigation, waits for DOM settlement then invokes the callback
 * with the new URL.
 */
export function initSPADetector(
  onNavigate: SettleCallback,
  config: Partial<SPADetectorConfig> = {}
): () => void {
  let lastUrl = location.href;

  const handleNavigation = () => {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;

    waitForDOMSettle(() => {
      onNavigate(currentUrl);
    }, config);
  };

  // Intercept History API calls
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState(...args);
    handleNavigation();
  };

  history.replaceState = function (
    ...args: Parameters<typeof history.replaceState>
  ) {
    originalReplaceState(...args);
    handleNavigation();
  };

  // Listen for popstate (back/forward)
  window.addEventListener("popstate", handleNavigation);

  // Cleanup function
  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", handleNavigation);
  };
}
