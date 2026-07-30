import { db } from "../lib/db.js";
import { DEFAULT_SETTINGS, clamp } from "../lib/utils.js";

const fields = {
  trackingSwitch: document.getElementById("tracking-switch"),
  screenshotSwitch: document.getElementById("screenshot-switch"),
  screenshotInterval: document.getElementById("screenshot-interval"),
  storeFullUrlSwitch: document.getElementById("store-full-url-switch"),
  retentionDays: document.getElementById("retention-days"),
  dailyGoalMinutes: document.getElementById("daily-goal-minutes"),
  apiProvider: document.getElementById("api-provider"),
  apiKey: document.getElementById("api-key"),
  cloudSyncSwitch: document.getElementById("cloud-sync-switch"),
  serverUrl: document.getElementById("server-url"),
  authToken: document.getElementById("auth-token"),
  theme: document.getElementById("theme"),
  indicatorPosition: document.getElementById("indicator-position"),
  distractionSites: document.getElementById("distraction-sites"),
  saveStatus: document.getElementById("save-status"),
  storageUsage: document.getElementById("storage-usage")
};

/**
 * Loads and binds the options page.
 */
async function initOptions() {
  const settings = await db.getSettings();
  fields.trackingSwitch.classList.toggle("on", settings.trackingEnabled);
  fields.screenshotSwitch.classList.toggle("on", settings.screenshotEnabled);
  fields.storeFullUrlSwitch.classList.toggle("on", settings.storeFullUrl);
  fields.cloudSyncSwitch.classList.toggle("on", settings.cloudSyncEnabled);
  fields.screenshotInterval.value = settings.screenshotInterval;
  fields.retentionDays.value = settings.maxDataAge;
  fields.dailyGoalMinutes.value = settings.dailyGoalMinutes;
  fields.apiProvider.value = settings.apiProvider || "openai";
  fields.theme.value = settings.theme;
  fields.indicatorPosition.value = settings.indicatorPosition || "top-right";
  fields.distractionSites.value = (settings.distractionSites || DEFAULT_SETTINGS.distractionSites).join("\n");
  fields.serverUrl.value = settings.serverUrl || "";
  fields.authToken.value = settings.authToken || "";
  fields.storageUsage.textContent = await buildStorageMessage();
}

/**
 * @returns {Promise<string>}
 */
async function buildStorageMessage() {
  const usage = await db.estimateUsage().catch(() => null);
  if (!usage) {
    return "Storage usage is unavailable right now.";
  }
  const usageMb = (usage.usage / (1024 * 1024)).toFixed(1);
  const quotaMb = (usage.quota / (1024 * 1024)).toFixed(1);
  return `IndexedDB usage: ${usageMb} MB of ${quotaMb} MB (${Math.round(usage.percent * 100)}%).`;
}

/**
 * @param {string} id
 * @returns {void}
 */
function toggleSwitch(id) {
  fields[id].classList.toggle("on");
}

/**
 * Saves the form values into IndexedDB and local settings.
 */
async function saveSettings() {
  const screenshotInterval = clamp(Number(fields.screenshotInterval.value || 30000), 15000, 60000);
  const maxDataAge = clamp(Number(fields.retentionDays.value || 90), 7, 365);
  const distractionSites = fields.distractionSites.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const secretId = "api-key-secret";
  let apiKeyCiphertext = "";
  if (fields.apiKey.value.trim()) {
    apiKeyCiphertext = await encryptSecret(fields.apiKey.value.trim(), secretId);
  }
  await db.saveSettings({
    trackingEnabled: fields.trackingSwitch.classList.contains("on"),
    screenshotEnabled: fields.screenshotSwitch.classList.contains("on"),
    screenshotInterval,
    storeFullUrl: fields.storeFullUrlSwitch.classList.contains("on"),
    maxDataAge,
    dailyGoalMinutes: clamp(Number(fields.dailyGoalMinutes.value || 240), 7, 1440),
    apiProvider: fields.apiProvider.value,
    apiKey: apiKeyCiphertext,
    cloudSyncEnabled: fields.cloudSyncSwitch.classList.contains("on"),
    serverUrl: fields.serverUrl.value.trim(),
    authToken: fields.authToken.value.trim(),
    theme: fields.theme.value,
    indicatorPosition: fields.indicatorPosition.value,
    distractionSites
  });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  fields.saveStatus.textContent = "Settings saved locally.";
  fields.storageUsage.textContent = await buildStorageMessage();
}

/**
 * @param {string} plaintext
 * @param {string} secretId
 * @returns {Promise<string>}
 */
async function encryptSecret(plaintext, secretId) {
  const secret = await ensureSecretKey(secretId);
  const encoded = new TextEncoder().encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secret, encoded);
  return `${arrayToBase64(iv)}.${arrayToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * @param {string} secretId
 * @returns {Promise<CryptoKey>}
 */
async function ensureSecretKey(secretId) {
  const stored = await db.getSecret(secretId);
  if (stored) {
    const raw = base64ToArray(stored);
    return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  await db.saveSecret(secretId, arrayToBase64(new Uint8Array(raw)));
  return key;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function arrayToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
function base64ToArray(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * @param {"json" | "csv"} format
 * @returns {Promise<void>}
 */
async function exportData(format) {
  const activities = await db.getAll("activities");
  const summaries = await db.getAll("dailySummaries");
  const settings = await db.getSettings();
  const payload = { exportedAt: new Date().toISOString(), settings, activities, summaries };
  const blob = format === "json"
    ? new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    : new Blob([toCsv(activities)], { type: "text/csv" });
  downloadBlob(blob, `visual-ai-activity-tracker.${format}`);
}

/**
 * @param {Array<any>} activities
 * @returns {string}
 */
function toCsv(activities) {
  const rows = ["id,url,hostname,title,category,startTime,endTime,duration,productivityScore,isIdle,createdAt"];
  for (const item of activities) {
    rows.push([
      item.id,
      escapeCsv(item.url),
      escapeCsv(item.hostname),
      escapeCsv(item.title),
      escapeCsv(item.category),
      item.startTime,
      item.endTime,
      item.duration,
      item.productivityScore ?? "",
      item.isIdle ? "true" : "false",
      item.createdAt
    ].join(","));
  }
  return rows.join("\n");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * @param {Blob} blob
 * @param {string} filename
 * @returns {void}
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Deletes the user's data after confirmation.
 * @param {boolean} clearSettings
 * @returns {Promise<void>}
 */
async function deleteAllData(clearSettings = true) {
  const confirmed = confirm("Delete all local browsing activity data? This cannot be undone.");
  if (!confirmed) {
    return;
  }
  await db.clear("activities");
  await db.clear("dailySummaries");
  await db.clear("meta");
  await db.clear("secrets");
  if (clearSettings) {
    await db.saveSettings({ ...DEFAULT_SETTINGS, onboardingAccepted: false });
  }
  fields.saveStatus.textContent = "All local data deleted.";
  fields.storageUsage.textContent = await buildStorageMessage();
}

/**
 * Deletes old data using the configured retention window.
 * @returns {Promise<void>}
 */
async function deleteOldData() {
  const settings = await db.getSettings();
  const result = await db.cleanupOldData({ maxScreenshotAgeDays: settings.maxScreenshotAge, maxDataAgeDays: settings.maxDataAge });
  fields.saveStatus.textContent = `Deleted ${result.activitiesDeleted} old activities and ${result.summariesDeleted} summaries.`;
  fields.storageUsage.textContent = await buildStorageMessage();
}

/**
 * @returns {Promise<void>}
 */
async function disconnectSync() {
  await db.saveSettings({ cloudSyncEnabled: false, serverUrl: "", authToken: "" });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  fields.cloudSyncSwitch.classList.remove("on");
  fields.serverUrl.value = "";
  fields.authToken.value = "";
  fields.saveStatus.textContent = "Sync disconnected locally.";
}

fields.trackingSwitch.addEventListener("click", () => toggleSwitch("trackingSwitch"));
fields.screenshotSwitch.addEventListener("click", () => toggleSwitch("screenshotSwitch"));
fields.storeFullUrlSwitch.addEventListener("click", () => toggleSwitch("storeFullUrlSwitch"));
fields.cloudSyncSwitch.addEventListener("click", () => toggleSwitch("cloudSyncSwitch"));
document.getElementById("save-settings").addEventListener("click", saveSettings);
document.getElementById("export-json").addEventListener("click", () => exportData("json"));
document.getElementById("export-csv").addEventListener("click", () => exportData("csv"));
document.getElementById("delete-all").addEventListener("click", () => deleteAllData(true));
document.getElementById("delete-old").addEventListener("click", deleteOldData);
document.getElementById("logout-sync").addEventListener("click", disconnectSync);
document.getElementById("view-privacy").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("PRIVACY.md") }).catch(() => undefined));

initOptions().catch(() => {
  fields.saveStatus.textContent = "Failed to load options.";
});
