import { db } from "../lib/db.js";
import { formatDuration, toIsoDateKey, getCategoryColor, getCategoryIcon, getCategoryLabel } from "../lib/utils.js";

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

let liveTimerInterval = null;

/**
 * Loads the popup state from IndexedDB and paints the compact chart.
 */
async function renderPopup() {
  const settings = await db.getSettings();
  if (settings.theme === "light") {
    document.body.classList.add("light-theme");
    document.body.setAttribute("data-theme", "light");
  } else {
    document.body.classList.remove("light-theme");
    document.body.setAttribute("data-theme", "dark");
  }

  const recent = await db.getRecentActivities(200);
  const session = await db.getMeta("activeSession");
  const todayKey = toIsoDateKey(Date.now());
  const todayActivities = recent.filter((item) => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
  const todaySeconds = todayActivities.reduce((total, item) => total + (item.duration || 0), 0);
  const averageProductivity = todayActivities.filter((item) => typeof item.productivityScore === "number");
  const productivityAverage = averageProductivity.length ? averageProductivity.reduce((total, item) => total + item.productivityScore, 0) / averageProductivity.length : 0;

  // Active Session details
  if (session && session.startTime) {
    updateLiveTimer(session.startTime);
    clearInterval(liveTimerInterval);
    liveTimerInterval = setInterval(() => updateLiveTimer(session.startTime), 1000);
  } else {
    sessionDuration.textContent = "0m 00s";
    clearInterval(liveTimerInterval);
  }

  const category = session?.category || "other";
  sessionCategory.textContent = `${getCategoryIcon(category)} ${getCategoryLabel(category)}`;
  sessionCategory.style.backgroundColor = `${getCategoryColor(category)}22`;
  sessionCategory.style.borderColor = `${getCategoryColor(category)}44`;
  sessionCategory.style.color = getCategoryColor(category);

  sessionScore.textContent = `${session?.productivityScore ?? 5}/10`;
  sessionSite.textContent = session?.hostname || "No active site";
  todayActive.textContent = formatDuration(todaySeconds);
  todayProductivity.textContent = productivityAverage ? productivityAverage.toFixed(1) : "0.0";
  todaySites.textContent = String(todayActivities.length);

  statusNode.textContent = settings.trackingEnabled ? "Tracking active" : "Tracking paused";
  syncStatus.textContent = settings.cloudSyncEnabled ? "Cloud sync ready" : "Local only";

  const toggleBtn = document.getElementById("toggle-tracking");
  toggleBtn.textContent = settings.trackingEnabled ? "Pause" : "Resume";
  toggleBtn.className = `button ${settings.trackingEnabled ? 'primary' : 'warning'}`;

  const focusBtn = document.getElementById("focus-mode");
  focusBtn.textContent = settings.focusModeEnabled ? "Focus: ON" : "Focus Mode";
  focusBtn.className = `button ${settings.focusModeEnabled ? 'warning' : 'success'}`;

  drawWeeklyChart(weeklyCanvas, buildSevenDaySeries(recent));
}

function updateLiveTimer(startTime) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  sessionDuration.textContent = formatDuration(elapsedSeconds);
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

  const isLight = document.body.classList.contains("light-theme");
  context.fillStyle = isLight ? "rgba(241,245,249,0.7)" : "rgba(2,6,23,0.38)";
  context.fillRect(0, 0, width, height);

  const maxValue = Math.max(1, ...series.map((item) => item.value));
  const barWidth = width / series.length;
  series.forEach((item, index) => {
    const barHeight = Math.max(8, (item.value / maxValue) * (height - 36));
    const x = index * barWidth + 8;
    const y = height - barHeight - 20;

    const gradient = context.createLinearGradient(0, y, 0, height);
    gradient.addColorStop(0, "#38bdf8");
    gradient.addColorStop(1, "#22c55e");
    context.fillStyle = gradient;
    context.fillRect(x, y, barWidth - 16, barHeight);

    context.fillStyle = isLight ? "#64748b" : "#94a3b8";
    context.font = `${11 * ratio}px Inter, system-ui`;
    context.textAlign = "center";
    context.fillText(item.label, x + (barWidth - 16) / 2, height - 4);
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
