import { db } from "./lib/db.js";
import { ensureOffscreenDocument, captureThumbnail } from "./lib/screenshot.js";
import { tracker } from "./lib/tracker.js";
import { DEFAULT_SETTINGS, extractUrlParts, isTrackableUrl, logDebug, now } from "./lib/utils.js";

const ALARM_SCREENSHOT_TICK = "visual-ai-screenshot-tick";
const ALARM_CLEANUP = "visual-ai-cleanup";
const ALARM_IDLE = "visual-ai-idle";
let currentTabSnapshot = null;

/**
 * @returns {Promise<void>}
 */
async function initialize() {
  let settings = await db.getSettings();
  if (settings.showFloatingIndicator === undefined) {
    settings = await db.saveSettings({ showFloatingIndicator: false });
  }
  await tracker.configure(settings);
  await tracker.resumeFromStorage();
  await chrome.idle.setDetectionInterval?.(60);
  await ensureOffscreenDocument().catch(() => undefined);
  createRecurringAlarms();
  const activeTab = await getFocusedTab();
  if (activeTab) {
    await handleActiveTab(activeTab);
  }
}

/**
 * @returns {void}
 */
function createRecurringAlarms() {
  chrome.alarms.create(ALARM_SCREENSHOT_TICK, { periodInMinutes: 1 / 6 });
  chrome.alarms.create(ALARM_CLEANUP, { periodInMinutes: 60 * 24 });
  chrome.alarms.create(ALARM_IDLE, { periodInMinutes: 1 });
}

/**
 * @returns {Promise<chrome.tabs.Tab | null>}
 */
async function getFocusedTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<void>}
 */
async function handleActiveTab(tab) {
  if (!tab || tab.id === undefined || !tab.url) {
    return;
  }
  currentTabSnapshot = tab;
  const settings = await db.getSettings();
  await tracker.configure(settings);
  if (tab.incognito) {
    await tracker.endSession({ reason: "incognito" });
    await sendTrackingState(tab.id, "incognito-paused", null, settings);
    return;
  }
  if (!isTrackableUrl(tab.url) || !settings.onboardingAccepted || !settings.trackingEnabled) {
    await tracker.endSession({ reason: "paused" });
    await sendTrackingState(tab.id, "paused", null, settings);
    return;
  }
  const title = tab.title || "";
  const favicon = tab.favIconUrl || "";
  const { hostname } = extractUrlParts(tab.url);
  if (tracker.activeSession && tracker.activeSession.tabId === tab.id) {
    const currentHostname = tracker.activeSession.hostname || "";
    if (currentHostname && hostname && currentHostname !== hostname) {
      await tracker.endSession({ reason: "navigation" });
      await tracker.startSession(tab.id, tab.windowId, tab.url, title, favicon, false);
    } else {
      await tracker.updateActiveMetadata(tab.url, title);
    }
    await sendTrackingState(tab.id, "recording", await db.getMeta("activeSession"), settings);
    return;
  }
  if (tracker.activeSession && tracker.activeSession.tabId !== tab.id) {
    await tracker.endSession({ reason: "tab-switch" });
  }
  await tracker.startSession(tab.id, tab.windowId, tab.url, title, favicon, false);
  await sendTrackingState(tab.id, "recording", await db.getMeta("activeSession"), settings);
}

/**
 * @param {number} tabId
 * @param {string} state
 * @param {any} session
 * @param {any} settings
 * @returns {Promise<void>}
 */
async function sendTrackingState(tabId, state, session, settings) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "TRACKER_STATE",
      state,
      session,
      settings: settings || (await db.getSettings()),
      formattedDuration: session ? formatDuration(Math.max(0, Math.floor((now() - session.startTime) / 1000))) : "0m 00s"
    });
  } catch {
    // Restricted pages do not accept messages; this is expected.
  }
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<void>}
 */
async function syncTitleAndCategory(tab) {
  if (!tab || tab.id === undefined || !tab.url) {
    return;
  }
  if (!tracker.activeSession || tracker.activeSession.tabId !== tab.id) {
    return;
  }
  await tracker.updateActiveMetadata(tab.url, tab.title || "");
}

/**
 * @returns {Promise<void>}
 */
async function runScreenshotTick() {
  if (!tracker.activeSession) {
    return;
  }
  const settings = await db.getSettings();
  await tracker.configure(settings);
  if (!tracker.activeSession || !tracker.currentSettings.screenshotEnabled) {
    return;
  }
  const target = tracker.getActiveTarget();
  if (!target) {
    return;
  }
  const tab = await chrome.tabs.get(target.tabId).catch(() => null);
  if (!tab || !tab.url || !isTrackableUrl(tab.url) || tab.incognito) {
    return;
  }
  const thumbnail = await captureThumbnail(target.tabId, tab.url);
  if (thumbnail) {
    await tracker.captureActiveScreenshot(thumbnail);
  }
}

/**
 * @returns {Promise<void>}
 */
async function cleanupData() {
  const settings = await db.getSettings();
  await db.cleanupOldData({ maxScreenshotAgeDays: settings.maxScreenshotAge, maxDataAgeDays: settings.maxDataAge });
  const usage = await db.estimateUsage().catch(() => null);
  if (usage && usage.percent > 0.8) {
    await db.cleanupOldData({ maxScreenshotAgeDays: Math.max(7, settings.maxScreenshotAge - 7), maxDataAgeDays: Math.max(30, settings.maxDataAge - 30) });
  }
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<void>}
 */
async function maybeShowFocusOverlay(tab) {
  if (!tab?.url) {
    return;
  }
  const settings = await db.getSettings();
  if (!settings.focusModeEnabled) {
    return;
  }
  const { hostname } = extractUrlParts(tab.url);
  if (!hostname) {
    return;
  }
  const distractingSites = settings.focusModeSites.length ? settings.focusModeSites : settings.distractionSites;
  const shouldBlock = distractingSites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
  if (shouldBlock) {
    await tracker.handleBlockedAttempt(hostname);
    await chrome.tabs.sendMessage(tab.id, { type: "FOCUS_MODE_ON" }).catch(() => undefined);
  } else {
    await chrome.tabs.sendMessage(tab.id, { type: "FOCUS_MODE_OFF" }).catch(() => undefined);
  }
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function handleTabRemoval(tabId) {
  if (tracker.activeSession?.tabId === tabId) {
    await tracker.endSession({ reason: "tab-closed" });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const existingSettings = await db.getSettings();
  const merged = { ...DEFAULT_SETTINGS, ...existingSettings };
  await db.saveSettings(merged);
  if (details?.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") }).catch(() => undefined);
  }
});

chrome.runtime.onStartup.addListener(() => {
  initialize().catch((error) => logDebug("startup_failed", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOGGLE_TRACKING") {
    db.getSettings().then(async (settings) => {
      const nextEnabled = !settings.trackingEnabled;
      const nextSettings = await db.saveSettings({ trackingEnabled: nextEnabled });
      await tracker.setTrackingEnabled(nextEnabled);
      sendResponse({ trackingEnabled: nextEnabled, settings: nextSettings });
    });
    return true;
  }
  if (message?.type === "SETTINGS_UPDATED") {
    db.getSettings().then(async (settings) => {
      await tracker.configure(settings);
      const activeTab = await getFocusedTab();
      if (activeTab) {
        await maybeShowFocusOverlay(activeTab);
        await handleActiveTab(activeTab);
      }
      sendResponse({ ok: true, settings });
    });
    return true;
  }
  if (message?.type === "TEST_API_KEY") {
    import("./lib/ai-service.js").then(async ({ AiService }) => {
      const service = new AiService();
      const res = await service.testApiKey(message.provider, message.apiKey);
      sendResponse(res);
    });
    return true;
  }
  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "PASSWORD_FOCUS_START") {
    tracker.pauseScreenshots("password").then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "PASSWORD_FOCUS_END") {
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "FOCUS_BREAK") {
    db.getSettings().then(async (settings) => {
      await db.saveSettings({ focusModeEnabled: false });
      sendResponse({ ok: true, settings: { ...settings, focusModeEnabled: false } });
    });
    return true;
  }
  if (message?.type === "DISABLE_FOCUS_MODE") {
    db.saveSettings({ focusModeEnabled: false }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === "toggle-tracking") {
    const settings = await db.getSettings();
    const nextEnabled = !settings.trackingEnabled;
    await db.saveSettings({ trackingEnabled: nextEnabled });
    await tracker.setTrackingEnabled(nextEnabled);
    const activeTab = await getFocusedTab();
    if (activeTab) {
      await sendTrackingState(activeTab.id, nextEnabled ? "recording" : "paused", await db.getMeta("activeSession"), await db.getSettings());
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    await handleActiveTab(tab);
    await maybeShowFocusOverlay(tab);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await handleActiveTab(tab);
    await maybeShowFocusOverlay(tab);
  }
  if (changeInfo.url && tab.active) {
    await handleActiveTab(tab);
    await maybeShowFocusOverlay(tab);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await handleTabRemoval(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await tracker.handleIdleState("idle");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) {
    await handleActiveTab(tab);
    await maybeShowFocusOverlay(tab);
  }
});

chrome.idle.onStateChanged.addListener(async (state) => {
  await tracker.handleIdleState(state);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_SCREENSHOT_TICK) {
    await runScreenshotTick();
  }
  if (alarm.name === ALARM_CLEANUP) {
    await cleanupData();
  }
  if (alarm.name === ALARM_IDLE) {
    const settings = await db.getSettings();
    if (!settings.trackingEnabled || !settings.onboardingAccepted) {
      return;
    }
    const activeTab = await getFocusedTab();
    if (activeTab) {
      await maybeShowFocusOverlay(activeTab);
    }
  }
});

initialize().catch((error) => logDebug("initialize_failed", error));

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
