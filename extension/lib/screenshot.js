import { clamp, isTrackableUrl, sleep } from "./utils.js";

let offscreenReady = false;
let captureRetryPending = false;

/**
 * Ensures the offscreen document exists before capture requests are sent.
 * @returns {Promise<void>}
 */
export async function ensureOffscreenDocument() {
  if (offscreenReady) {
    return;
  }
  if (chrome.offscreen?.hasDocument) {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      offscreenReady = true;
      return;
    }
  }
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["CLIPBOARD", "DOM_PARSER"],
    justification: "Capture and compress screenshots for the local productivity tracker."
  });
  offscreenReady = true;
}

/**
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<string | null>}
 */
export async function captureThumbnail(tabId, url) {
  if (!isTrackableUrl(url)) {
    return null;
  }
  await ensureOffscreenDocument();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_THUMBNAIL",
      tabId,
      url,
      maxWidth: 800,
      maxHeight: 600,
      quality: 0.6
    });
    return response?.thumbnail || null;
  } catch (error) {
    if (captureRetryPending) {
      return null;
    }
    captureRetryPending = true;
    await sleep(5000);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_THUMBNAIL",
        tabId,
        url,
        maxWidth: 800,
        maxHeight: 600,
        quality: 0.6
      });
      return response?.thumbnail || null;
    } catch {
      return null;
    } finally {
      captureRetryPending = false;
    }
  }
}

/**
 * @param {string} thumbnail
 * @param {number} minimumQuality
 * @returns {Promise<boolean>}
 */
export async function isThumbnailWithinBudget(thumbnail, minimumQuality = 0.35) {
  if (!thumbnail) {
    return true;
  }
  const quality = clamp(minimumQuality, 0.1, 1);
  const blob = await (await fetch(thumbnail)).blob();
  return blob.size <= 50 * 1024 || quality <= 0.1;
}
