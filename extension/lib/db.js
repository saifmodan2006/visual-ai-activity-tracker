import { DEFAULT_SETTINGS, mergeSettings, toIsoDateKey } from "./utils.js";

const DB_NAME = "visual-ai-activity-tracker";
const DB_VERSION = 1;

/**
 * @typedef {{
 *   id?: number,
 *   url: string,
 *   hostname: string,
 *   title: string,
 *   category: string,
 *   startTime: number,
 *   endTime: number,
 *   duration: number,
 *   screenshots: Array<{timestamp: number, thumbnail: string}>,
 *   productivityScore: number | null,
 *   isIdle: boolean,
 *   createdAt: number
 * }} ActivityRecord
 */

/**
 * Minimal IndexedDB wrapper that exposes a Promise-based API.
 */
export class ActivityDatabase {
  constructor() {
    this.dbPromise = null;
  }

  /**
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("activities")) {
          const activities = database.createObjectStore("activities", { keyPath: "id", autoIncrement: true });
          activities.createIndex("startTime", "startTime", { unique: false });
          activities.createIndex("hostname", "hostname", { unique: false });
          activities.createIndex("category", "category", { unique: false });
          activities.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!database.objectStoreNames.contains("dailySummaries")) {
          const summaries = database.createObjectStore("dailySummaries", { keyPath: "id", autoIncrement: true });
          summaries.createIndex("date", "date", { unique: false });
        }
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("secrets")) {
          database.createObjectStore("secrets", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  /**
   * @template T
   * @param {IDBDatabase} database
   * @param {string} storeName
   * @param {'readonly' | 'readwrite'} mode
   * @param {(store: IDBObjectStore) => IDBRequest<T> | Promise<T>} executor
   * @returns {Promise<T>}
   */
  async run(database, storeName, mode, executor) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try {
        request = executor(store);
      } catch (error) {
        reject(error);
        return;
      }
      if (request instanceof Promise) {
        request.then(resolve, reject);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @param {string} storeName
   * @param {any} value
   * @returns {Promise<any>}
   */
  async put(storeName, value) {
    const database = await this.open();
    return this.run(database, storeName, "readwrite", (store) => store.put(value));
  }

  /**
   * @param {string} storeName
   * @param {string | number} key
   * @returns {Promise<any>}
   */
  async get(storeName, key) {
    const database = await this.open();
    return this.run(database, storeName, "readonly", (store) => store.get(key));
  }

  /**
   * @param {string} storeName
   * @returns {Promise<any[]>}
   */
  async getAll(storeName) {
    const database = await this.open();
    return this.run(database, storeName, "readonly", (store) => store.getAll());
  }

  /**
   * @param {string} storeName
   * @param {string} indexName
   * @param {IDBValidKey | IDBKeyRange} query
   * @returns {Promise<any[]>}
   */
  async getAllFromIndex(storeName, indexName, query) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(query);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @param {string} storeName
   * @param {string | number} key
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    const database = await this.open();
    await this.run(database, storeName, "readwrite", (store) => store.delete(key));
  }

  /**
   * @param {string} storeName
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    const database = await this.open();
    await this.run(database, storeName, "readwrite", (store) => store.clear());
  }

  /**
   * @returns {Promise<Record<string, any>>}
   */
  async getSettings() {
    const settings = await this.get("settings", "user-settings");
    return mergeSettings(DEFAULT_SETTINGS, settings || {});
  }

  /**
   * @param {Record<string, any>} patch
   * @returns {Promise<Record<string, any>>}
   */
  async saveSettings(patch) {
    const current = await this.getSettings();
    const next = mergeSettings(current, patch);
    await this.put("settings", next);
    return next;
  }

  /**
   * @param {ActivityRecord} activity
   * @returns {Promise<number>}
   */
  async addActivity(activity) {
    const database = await this.open();
    return this.run(database, "activities", "readwrite", (store) => store.add(activity));
  }

  /**
   * @param {ActivityRecord} activity
   * @returns {Promise<number>}
   */
  async updateActivity(activity) {
    const database = await this.open();
    return this.run(database, "activities", "readwrite", (store) => store.put(activity));
  }

  /**
   * @param {number} limit
   * @returns {Promise<any[]>}
   */
  async getRecentActivities(limit = 50) {
    const activities = await this.getAll("activities");
    return activities.sort((left, right) => right.startTime - left.startTime).slice(0, limit);
  }

  /**
   * @param {string} dateKey
   * @returns {Promise<any | undefined>}
   */
  async getDailySummary(dateKey) {
    const summaries = await this.getAll("dailySummaries");
    return summaries.find((summary) => summary.date === dateKey);
  }

  /**
   * @param {any} summary
   * @returns {Promise<number>}
   */
  async saveDailySummary(summary) {
    return this.put("dailySummaries", summary);
  }

  /**
   * @param {string} id
   * @param {string} value
   * @returns {Promise<void>}
   */
  async saveSecret(id, value) {
    await this.put("secrets", { id, value });
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getSecret(id) {
    const entry = await this.get("secrets", id);
    return entry?.value || "";
  }

  /**
   * @param {string} id
   * @param {any} value
   * @returns {Promise<void>}
   */
  async saveMeta(id, value) {
    await this.put("meta", { id, value });
  }

  /**
   * @param {string} id
   * @returns {Promise<any>}
   */
  async getMeta(id) {
    const entry = await this.get("meta", id);
    return entry?.value;
  }

  /**
   * @param {number} olderThanTimestamp
   * @returns {Promise<number>}
   */
  async deleteActivitiesOlderThan(olderThanTimestamp) {
    const activities = await this.getAll("activities");
    const database = await this.open();
    const transaction = database.transaction("activities", "readwrite");
    const store = transaction.objectStore("activities");
    let deleted = 0;
    for (const activity of activities) {
      if (activity.endTime && activity.endTime < olderThanTimestamp) {
        store.delete(activity.id);
        deleted += 1;
      }
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    return deleted;
  }

  /**
   * @param {number} olderThanTimestamp
   * @returns {Promise<number>}
   */
  async deleteSummariesOlderThan(olderThanTimestamp) {
    const summaries = await this.getAll("dailySummaries");
    const database = await this.open();
    const transaction = database.transaction("dailySummaries", "readwrite");
    const store = transaction.objectStore("dailySummaries");
    let deleted = 0;
    for (const summary of summaries) {
      const summaryTimestamp = new Date(summary.date).getTime();
      if (summaryTimestamp < olderThanTimestamp) {
        store.delete(summary.id);
        deleted += 1;
      }
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    return deleted;
  }

  /**
   * @param {object} options
   * @param {number} options.maxScreenshotAgeDays
   * @param {number} options.maxDataAgeDays
   * @returns {Promise<{activitiesDeleted: number, summariesDeleted: number}>}
   */
  async cleanupOldData({ maxScreenshotAgeDays, maxDataAgeDays }) {
    const dataAgeThreshold = Date.now() - maxDataAgeDays * 24 * 60 * 60 * 1000;
    const activityResults = await this.deleteActivitiesOlderThan(dataAgeThreshold);
    const summaryResults = await this.deleteSummariesOlderThan(dataAgeThreshold);

    const activities = await this.getAll("activities");
    const database = await this.open();
    const transaction = database.transaction("activities", "readwrite");
    const store = transaction.objectStore("activities");
    const screenshotThreshold = Date.now() - maxScreenshotAgeDays * 24 * 60 * 60 * 1000;
    for (const activity of activities) {
      const screenshots = Array.isArray(activity.screenshots)
        ? activity.screenshots.filter((entry) => entry.timestamp >= screenshotThreshold)
        : [];
      if (!activity.screenshots || screenshots.length !== activity.screenshots.length) {
        store.put({ ...activity, screenshots });
      }
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });

    return { activitiesDeleted: activityResults, summariesDeleted: summaryResults };
  }

  /**
   * @param {string} dateKey
   * @returns {Promise<any>}
   */
  async buildDailySummary(dateKey) {
    const activities = await this.getAll("activities");
    const dayActivities = activities.filter((activity) => toIsoDateKey(activity.startTime) === dateKey || toIsoDateKey(activity.endTime) === dateKey);
    const categoryBreakdown = {};
    const siteMap = new Map();
    let totalActiveSeconds = 0;
    let totalIdleSeconds = 0;
    let screenshotCount = 0;
    let productivityTotal = 0;
    let productivityCount = 0;

    for (const activity of dayActivities) {
      totalActiveSeconds += activity.isIdle ? 0 : activity.duration || 0;
      totalIdleSeconds += activity.isIdle ? activity.duration || 0 : 0;
      categoryBreakdown[activity.category || "other"] = (categoryBreakdown[activity.category || "other"] || 0) + (activity.duration || 0);
      const siteKey = activity.hostname || "";
      const existing = siteMap.get(siteKey) || { hostname: siteKey, seconds: 0, visits: 0 };
      existing.seconds += activity.duration || 0;
      existing.visits += 1;
      siteMap.set(siteKey, existing);
      screenshotCount += Array.isArray(activity.screenshots) ? activity.screenshots.length : 0;
      if (typeof activity.productivityScore === "number") {
        productivityTotal += activity.productivityScore;
        productivityCount += 1;
      }
    }

    const summary = {
      date: dateKey,
      totalActiveSeconds,
      totalIdleSeconds,
      categoryBreakdown,
      siteBreakdown: Array.from(siteMap.values()).sort((left, right) => right.seconds - left.seconds),
      productivityAverage: productivityCount > 0 ? Number((productivityTotal / productivityCount).toFixed(2)) : null,
      screenshotCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blockedAttempts: 0
    };
    await this.put("dailySummaries", summary);
    return summary;
  }

  /**
   * @returns {Promise<{usage: number, quota: number, percent: number}>}
   */
  async estimateUsage() {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    return { usage, quota, percent: quota > 0 ? usage / quota : 0 };
  }
}

export const db = new ActivityDatabase();
