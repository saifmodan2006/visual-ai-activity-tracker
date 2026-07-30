import { db } from "../lib/db.js";
import { formatDuration, toIsoDateKey } from "../lib/utils.js";

const sessionDuration = document.getElementById("session-duration");
const sessionCategory = document.getElementById("session-category");
const sessionScore = document.getElementById("session-score");
const sessionSite = document.getElementById("session-site");
const todayActive = document.getElementById("today-active");
const todayProductivity = document.getElementById("today-productivity");
const todaySites = document.getElementById("today-sites");
const statusNode = document.getElementById("popup-status");
const syncStatus = document.getElementById("sync-status");
const weeklyCanvas = document.getElementById("weekly-chart");

/**
 * Loads the popup state from IndexedDB and paints the compact chart.
 */
async function renderPopup() {
  const settings = await db.getSettings();
  const recent = await db.getRecentActivities(100);
  const session = await db.getMeta("activeSession");
  const todayKey = toIsoDateKey(Date.now());
  const todayActivities = recent.filter((item) => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
  const todaySeconds = todayActivities.reduce((total, item) => total + (item.duration || 0), 0);
  const averageProductivity = todayActivities.filter((item) => typeof item.productivityScore === "number");
  const productivityAverage = averageProductivity.length ? averageProductivity.reduce((total, item) => total + item.productivityScore, 0) / averageProductivity.length : 0;

  sessionDuration.textContent = session ? formatDuration(Math.max(0, Math.floor((Date.now() - session.startTime) / 1000))) : "0m 00s";
  sessionCategory.textContent = session?.category || "other";
  sessionScore.textContent = `${session?.productivityScore ?? 5}/10`;
  sessionSite.textContent = session?.hostname || "No active site";
  todayActive.textContent = formatDuration(todaySeconds);
  todayProductivity.textContent = productivityAverage ? productivityAverage.toFixed(1) : "0.0";
  todaySites.textContent = String(todayActivities.length);
  statusNode.textContent = settings.trackingEnabled ? "Tracking active" : "Tracking paused";
  syncStatus.textContent = settings.cloudSyncEnabled ? "Cloud sync ready" : "Local only";
  document.getElementById("toggle-tracking").textContent = settings.trackingEnabled ? "Pause" : "Resume";
  drawWeeklyChart(weeklyCanvas, buildSevenDaySeries(recent));
}

/**
 * @param {Array<any>} activities
 * @returns {{label: string, value: number}[]}
 */
function buildSevenDaySeries(activities) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    return { label: day.toLocaleDateString(undefined, { weekday: "short" }), value: 0, key: toIsoDateKey(day) };
  });
  for (const activity of activities) {
    const day = days.find((entry) => entry.key === toIsoDateKey(activity.startTime));
    if (day) {
      day.value += activity.duration || 0;
    }
  }
  return days;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number}[]} series
 * @returns {void}
 */
function drawWeeklyChart(canvas, series) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth * ratio;
  const height = canvas.clientHeight * ratio;
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(2,6,23,0.38)";
  context.fillRect(0, 0, width, height);
  const maxValue = Math.max(1, ...series.map((item) => item.value));
  const barWidth = width / series.length;
  series.forEach((item, index) => {
    const barHeight = Math.max(12, (item.value / maxValue) * (height - 40));
    const x = index * barWidth + 12;
    const y = height - barHeight - 24;
    const gradient = context.createLinearGradient(0, y, 0, height);
    gradient.addColorStop(0, "#38bdf8");
    gradient.addColorStop(1, "#22c55e");
    context.fillStyle = gradient;
    context.fillRect(x, y, barWidth - 24, barHeight);
    context.fillStyle = "#94a3b8";
    context.font = `${12 * ratio}px system-ui`;
    context.textAlign = "center";
    context.fillText(item.label, x + (barWidth - 24) / 2, height - 6);
  });
}

document.getElementById("toggle-tracking").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "TOGGLE_TRACKING" });
  await renderPopup();
});
document.getElementById("focus-mode").addEventListener("click", async () => {
  const settings = await db.getSettings();
  await db.saveSettings({ focusModeEnabled: !settings.focusModeEnabled });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  await renderPopup();
});
document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("open-dashboard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") }));

renderPopup().catch(async () => {
  sessionDuration.textContent = "Unavailable";
  statusNode.textContent = "Could not load popup state";
});
