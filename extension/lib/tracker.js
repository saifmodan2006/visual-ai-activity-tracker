import { categorizeLocally } from "./categorizer.js";
import { captureThumbnail } from "./screenshot.js";
import { db } from "./db.js";
import { DEFAULT_SETTINGS, extractUrlParts, formatDuration, isDistractingSite, isTrackableUrl, now, toIsoDateKey } from "./utils.js";

/**
 * State manager for the active tracking session.
 */
export class ActivityTracker {
  constructor() {
    this.activeSession = null;
    this.latestTabId = null;
    this.latestWindowId = null;
    this.currentSettings = { ...DEFAULT_SETTINGS };
    this.screenshotCounts = new Map();
    this.passwordPauseUntil = 0;
    this.lastUserState = "active";
    this.dailyFlushPromise = Promise.resolve();
  }

  /**
   * @param {Record<string, any>} settings
   * @returns {Promise<void>}
   */
  async configure(settings) {
    this.currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  }

  /**
   * @returns {boolean}
   */
  isTrackingAllowed() {
    return Boolean(this.currentSettings.trackingEnabled && this.currentSettings.onboardingAccepted);
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  canTrackUrl(url) {
    return this.isTrackingAllowed() && isTrackableUrl(url);
  }

  /**
   * @param {number} tabId
   * @param {number} windowId
   * @param {string} url
   * @param {string} title
   * @param {string} favicon
   * @param {boolean} incognito
   * @returns {Promise<void>}
   */
  async startSession(tabId, windowId, url, title, favicon, incognito) {
    if (incognito || !this.canTrackUrl(url)) {
      await this.endSession({ reason: incognito ? "incognito" : "paused" });
      return;
    }
    const { hostname, fullUrl } = extractUrlParts(url);
    const category = categorizeLocally(fullUrl, title);
    this.activeSession = {
      tabId,
      windowId,
      url: this.currentSettings.storeFullUrl ? fullUrl : hostname ? `https://${hostname}` : fullUrl,
      hostname,
      title: title || "",
      favicon: favicon || "",
      category: category.category,
      productivityScore: category.productivityScore,
      startTime: now(),
      endTime: null,
      screenshots: [],
      isIdle: false,
      createdAt: now(),
      lastScreenshotAt: 0,
      lastUpdateAt: now(),
      tabCountedKey: `${windowId}:${tabId}`
    };
    await db.saveMeta("activeSession", this.activeSession);
    await this.pushIndicatorState("recording");
  }

  /**
   * @param {{reason?: string}} [options]
   * @returns {Promise<void>}
   */
  async endSession(options = {}) {
    if (!this.activeSession) {
      return;
    }
    const endedSession = { ...this.activeSession, endTime: now() };
    endedSession.duration = Math.max(0, Math.round((endedSession.endTime - endedSession.startTime) / 1000));
    await db.addActivity(endedSession);
    await this.syncDailySummary(endedSession.endTime);
    this.activeSession = null;
    await db.saveMeta("activeSession", null);
    await this.pushIndicatorState(options.reason === "incognito" ? "incognito-paused" : "paused");
  }

  /**
   * @param {string} url
   * @param {string} title
   * @returns {Promise<void>}
   */
  async updateActiveMetadata(url, title) {
    if (!this.activeSession || !this.canTrackUrl(url)) {
      return;
    }
    const { hostname, fullUrl } = extractUrlParts(url);
    this.activeSession.url = this.currentSettings.storeFullUrl ? fullUrl : hostname ? `https://${hostname}` : fullUrl;
    this.activeSession.hostname = hostname;
    this.activeSession.title = title || this.activeSession.title;
    const category = categorizeLocally(fullUrl, title || this.activeSession.title);
    this.activeSession.category = category.category;
    this.activeSession.productivityScore = category.productivityScore;
    this.activeSession.lastUpdateAt = now();
    await db.saveMeta("activeSession", this.activeSession);
  }

  /**
   * @returns {Promise<boolean>}
   */
  async shouldCaptureScreenshot() {
    if (!this.activeSession || !this.currentSettings.screenshotEnabled || !this.isTrackingAllowed()) {
      return false;
    }
    const nowValue = now();
    if (nowValue < this.passwordPauseUntil) {
      return false;
    }
    if (this.lastUserState !== "active") {
      return false;
    }
    const siteKey = this.activeSession.hostname || this.activeSession.url;
    const timestamps = this.screenshotCounts.get(siteKey) || [];
    const recent = timestamps.filter((timestamp) => nowValue - timestamp < 60 * 60 * 1000);
    this.screenshotCounts.set(siteKey, recent);
    return recent.length < 10;
  }

  /**
   * @param {string} thumbnail
   * @returns {Promise<void>}
   */
  async captureActiveScreenshot(thumbnail) {
    if (!this.activeSession || !thumbnail) {
      return;
    }
    this.activeSession.screenshots.push({ timestamp: now(), thumbnail });
    const siteKey = this.activeSession.hostname || this.activeSession.url;
    const timestamps = this.screenshotCounts.get(siteKey) || [];
    timestamps.push(now());
    this.screenshotCounts.set(siteKey, timestamps);
    if (this.activeSession.screenshots.length > 10) {
      this.activeSession.screenshots = this.activeSession.screenshots.slice(-10);
    }
    await db.saveMeta("activeSession", this.activeSession);
    await this.pushScreenshotFlash();
  }

  /**
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async pauseScreenshots(reason) {
    this.passwordPauseUntil = Math.max(this.passwordPauseUntil, now() + 30 * 1000);
    await this.pushIndicatorState(reason === "password" ? "password-paused" : "paused");
  }

  /**
   * @param {string} state
   * @returns {Promise<void>}
   */
  async pushIndicatorState(state) {
    if (!this.activeSession?.tabId) {
      return;
    }
    try {
      await chrome.tabs.sendMessage(this.activeSession.tabId, {
        type: "TRACKER_STATE",
        state,
        session: this.activeSession,
        settings: this.currentSettings,
        formattedDuration: formatDuration(Math.max(0, Math.floor((now() - this.activeSession.startTime) / 1000)))
      });
    } catch {
      // Content scripts are not always available on restricted pages; fail quietly.
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async pushScreenshotFlash() {
    if (!this.activeSession?.tabId) {
      return;
    }
    try {
      await chrome.tabs.sendMessage(this.activeSession.tabId, { type: "SCREENSHOT_FLASH" });
    } catch {
      // Best-effort notification only.
    }
  }

  /**
   * @param {number} timestamp
   * @returns {Promise<void>}
   */
  async syncDailySummary(timestamp) {
    const dateKey = toIsoDateKey(timestamp);
    this.dailyFlushPromise = this.dailyFlushPromise.then(() => db.buildDailySummary(dateKey)).catch(() => undefined);
    await this.dailyFlushPromise;
  }

  /**
   * @param {"active" | "idle" | "locked"} state
   * @returns {Promise<void>}
   */
  async handleIdleState(state) {
    this.lastUserState = state;
    if (state === "active") {
      if (this.activeSession) {
        await this.pushIndicatorState("recording");
      }
      return;
    }
    if (this.activeSession) {
      this.activeSession.isIdle = true;
      await this.endSession({ reason: state });
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async resumeFromStorage() {
    const stored = await db.getMeta("activeSession");
    if (stored && stored.tabId && stored.startTime && !stored.endTime) {
      stored.endTime = now();
      stored.duration = Math.max(0, Math.round((stored.endTime - stored.startTime) / 1000));
      await db.addActivity(stored);
    }
    this.activeSession = null;
    await db.saveMeta("activeSession", null);
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setTrackingEnabled(enabled) {
    this.currentSettings.trackingEnabled = Boolean(enabled);
    if (!enabled) {
      await this.endSession({ reason: "paused" });
    }
  }

  /**
   * @param {string} hostname
   * @returns {Promise<void>}
   */
  async handleBlockedAttempt(hostname) {
    const dateKey = toIsoDateKey(now());
    const summary = (await db.getDailySummary(dateKey)) || (await db.buildDailySummary(dateKey));
    summary.blockedAttempts = (summary.blockedAttempts || 0) + 1;
    await db.saveDailySummary(summary);
    if (isDistractingSite(hostname, this.currentSettings.focusModeSites.length ? this.currentSettings.focusModeSites : this.currentSettings.distractionSites)) {
      await this.pushIndicatorState("focus-mode");
    }
  }

  /**
   * @returns {Promise<{tabId: number, windowId: number} | null>}
   */
  getActiveTarget() {
    if (!this.activeSession) {
      return null;
    }
    return { tabId: this.activeSession.tabId, windowId: this.activeSession.windowId };
  }
}

export const tracker = new ActivityTracker();
