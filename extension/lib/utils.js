/**
 * Shared utility helpers for the extension runtime.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  id: "user-settings",
  trackingEnabled: true,
  onboardingAccepted: false,
  screenshotEnabled: true,
  screenshotInterval: 30000,
  storeFullUrl: false,
  maxScreenshotAge: 30,
  maxDataAge: 90,
  cloudSyncEnabled: false,
  apiKey: "",
  apiProvider: "openai",
  distractionSites: [
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "reddit.com",
    "youtube.com"
  ],
  focusModeEnabled: false,
  focusModeSites: [],
  dailyGoalMinutes: 240,
  theme: "dark",
  indicatorPosition: "top-right",
  aiRateLimitPerMinute: 1,
  aiRateLimitPerDay: 50,
  storageWarningThresholdMb: 500
});

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * @param {Date | number | string} value
 * @returns {string}
 */
export function toIsoDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isTrackableUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  return !/^(chrome|edge|about|file|view-source|moz-extension|chrome-extension):/i.test(url);
}

/**
 * @param {string} url
 * @returns {{hostname: string, fullUrl: string}}
 */
export function extractUrlParts(url) {
  if (!isTrackableUrl(url)) {
    return { hostname: "", fullUrl: url || "" };
  }
  try {
    const parsed = new URL(url);
    return { hostname: parsed.hostname, fullUrl: parsed.href };
  } catch {
    return { hostname: "", fullUrl: url };
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}

/**
 * @param {string} hostname
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function matchesHostPattern(hostname, patterns) {
  const normalized = normalizeHostname(hostname);
  return patterns.some((pattern) => normalized === normalizeHostname(pattern) || normalized.endsWith(`.${normalizeHostname(pattern)}`));
}

/**
 * @param {unknown} value
 * @param {T} fallback
 * @template T
 * @returns {T}
 */
export function safeJsonParse(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * @param {Record<string, any>} base
 * @param {Partial<Record<string, any>>} patch
 * @returns {Record<string, any>}
 */
export function mergeSettings(base, patch) {
  return {
    ...DEFAULT_SETTINGS,
    ...base,
    ...patch,
    id: "user-settings"
  };
}

/**
 * @param {string} message
 * @param {any} [details]
 * @returns {void}
 */
export function logDebug(message, details) {
  if (details === undefined) {
    console.debug(`[Visual AI] ${message}`);
    return;
  }
  console.debug(`[Visual AI] ${message}`, details);
}

/**
 * @param {number} thresholdMinutes
 * @returns {number}
 */
export function minutesToSeconds(thresholdMinutes) {
  return Math.max(0, Math.floor(thresholdMinutes * 60));
}

/**
 * @returns {number}
 */
export function now() {
  return Date.now();
}

/**
 * @param {string} hostname
 * @param {string[]} sites
 * @returns {boolean}
 */
export function isDistractingSite(hostname, sites) {
  return matchesHostPattern(hostname, sites);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}
