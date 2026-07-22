/**
 * Domain Blocklist — prevents capture of sensitive pages.
 *
 * Implements a default blocklist covering banking, email, health, and
 * authentication pages. Users can add/remove domains via the Side Panel.
 * The blocklist is persisted in chrome.storage.local.
 */

/** Default domains and URL patterns that should never be captured. */
const DEFAULT_BLOCKED_DOMAINS: string[] = [
  // Banking & Finance
  "*.bank.*",
  "*.banking.*",
  "paypal.com",
  "venmo.com",
  "chase.com",
  "wellsfargo.com",
  "bankofamerica.com",
  "capitalone.com",
  "citibank.com",

  // Email
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "mail.yahoo.com",
  "proton.me",
  "protonmail.com",

  // Health
  "*.health.*",
  "*.patient.*",
  "*.medical.*",
  "mychart.com",

  // Social DMs & Private
  "messages.google.com",
  "web.whatsapp.com",
  "web.telegram.org",
  "discord.com",

  // Password Managers
  "vault.bitwarden.com",
  "my.1password.com",
  "lastpass.com",
];

/** URL path segments that indicate sensitive pages regardless of domain. */
const BLOCKED_PATH_PATTERNS: RegExp[] = [
  /\/login/i,
  /\/signin/i,
  /\/signup/i,
  /\/password/i,
  /\/oauth/i,
  /\/checkout/i,
  /\/payment/i,
  /\/account\/settings/i,
  /\/billing/i,
  /\/admin/i,
];

const STORAGE_KEY = "blocklist_config";

export interface BlocklistConfig {
  /** Domains blocked by the user (in addition to defaults). */
  userBlocked: string[];
  /** Domains explicitly allowed (overrides defaults). */
  userAllowed: string[];
  /** Whether capture is globally paused. */
  isPaused: boolean;
}

const DEFAULT_CONFIG: BlocklistConfig = {
  userBlocked: [],
  userAllowed: [],
  isPaused: false,
};

/**
 * Load the blocklist configuration from chrome.storage.local.
 */
export async function loadBlocklistConfig(): Promise<BlocklistConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { ...DEFAULT_CONFIG };
}

/**
 * Save the blocklist configuration to chrome.storage.local.
 */
export async function saveBlocklistConfig(
  config: BlocklistConfig
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/**
 * Check if a domain matches a blocklist pattern.
 * Supports wildcard patterns like "*.bank.*".
 */
function matchesDomainPattern(domain: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexStr}$`, "i");
  return regex.test(domain);
}

/**
 * Determine if a URL should be blocked from capture.
 * Checks against default blocklist, user blocklist, user allowlist,
 * and sensitive path patterns.
 */
export async function isUrlBlocked(url: string): Promise<boolean> {
  const config = await loadBlocklistConfig();

  // Global pause check
  if (config.isPaused) return true;

  let hostname: string;
  let pathname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    return true; // Block unparseable URLs
  }

  // Check user allowlist first (explicit override)
  for (const allowed of config.userAllowed) {
    if (matchesDomainPattern(hostname, allowed)) {
      return false;
    }
  }

  // Check default blocklist
  for (const blocked of DEFAULT_BLOCKED_DOMAINS) {
    if (matchesDomainPattern(hostname, blocked)) {
      return true;
    }
  }

  // Check user blocklist
  for (const blocked of config.userBlocked) {
    if (matchesDomainPattern(hostname, blocked)) {
      return true;
    }
  }

  // Check sensitive path patterns
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(pathname)) {
      return true;
    }
  }

  return false;
}

/**
 * Add a domain to the user blocklist.
 */
export async function blockDomain(domain: string): Promise<void> {
  const config = await loadBlocklistConfig();
  if (!config.userBlocked.includes(domain)) {
    config.userBlocked.push(domain);
    await saveBlocklistConfig(config);
  }
}

/**
 * Remove a domain from the user blocklist.
 */
export async function unblockDomain(domain: string): Promise<void> {
  const config = await loadBlocklistConfig();
  config.userBlocked = config.userBlocked.filter((d) => d !== domain);
  await saveBlocklistConfig(config);
}

/**
 * Toggle the global capture pause state.
 */
export async function togglePause(): Promise<boolean> {
  const config = await loadBlocklistConfig();
  config.isPaused = !config.isPaused;
  await saveBlocklistConfig(config);
  return config.isPaused;
}

/**
 * Get the current pause state.
 */
export async function isPaused(): Promise<boolean> {
  const config = await loadBlocklistConfig();
  return config.isPaused;
}
