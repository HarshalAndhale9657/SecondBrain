/**
 * URL Cleaner — strips tracking parameters, normalizes URLs for deduplication.
 *
 * Modern web architecture appends dynamic tracking parameters (UTM, fbclid, gclid, etc.)
 * that create distinct URLs for identical content. This module normalizes URLs before
 * they enter the dedup pipeline.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "spm",
  "s_kwcid",
  "wickedid",
  "_hsenc",
  "_hsmi",
  "hsa_cam",
  "hsa_grp",
  "hsa_mt",
  "hsa_src",
  "hsa_ad",
  "hsa_acc",
  "hsa_net",
  "hsa_ver",
  "hsa_la",
  "hsa_ol",
  "hsa_kw",
  "hsa_tgt",
]);

/**
 * Remove tracking parameters from a URL while preserving meaningful query params.
 * Also normalizes trailing slashes, fragment identifiers, and protocol casing.
 */
export function cleanUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // Remove tracking parameters
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }

    // Sort remaining params for deterministic comparison
    url.searchParams.sort();

    // Remove trailing hash if it's empty or a tracking fragment
    if (url.hash === "#" || url.hash.startsWith("#utm_")) {
      url.hash = "";
    }

    // Normalize: remove trailing slash from path (unless root)
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    // If URL parsing fails, return the original
    return rawUrl;
  }
}

/**
 * Extract a human-readable domain from a URL for display purposes.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
