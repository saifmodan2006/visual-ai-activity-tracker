import { db } from "../lib/db.js";
import { formatDuration, toIsoDateKey } from "../lib/utils.js";

const categoryCanvas = document.getElementById("category-chart");
const heatmapCanvas = document.getElementById("heatmap-chart");
const trendCanvas = document.getElementById("trend-chart");
const sitesCanvas = document.getElementById("sites-chart");
const insightsList = document.getElementById("insights-list");
const recentGrid = document.getElementById("recent-grid");

/**
 * Loads dashboard data and draws local charts.
 */
async function renderDashboard() {
  const settings = await db.getSettings();
  const activities = await db.getRecentActivities(500);
  const todayKey = toIsoDateKey(Date.now());
  const today = activities.filter((item) => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
  const summaries = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date();
    day.setDate(day.getDate() - (13 - offset));
    const key = toIsoDateKey(day);
    const dayActivities = activities.filter((item) => toIsoDateKey(item.startTime) === key || toIsoDateKey(item.endTime) === key);
    const productivity = dayActivities.filter((item) => typeof item.productivityScore === "number");
    summaries.push({
      key,
      label: day.toLocaleDateString(undefined, { weekday: "short" }),
      active: dayActivities.reduce((total, item) => total + (item.duration || 0), 0),
      score: productivity.length ? productivity.reduce((total, item) => total + item.productivityScore, 0) / productivity.length : 0,
      heat: dayActivities.reduce((total, item) => total + (item.isIdle ? 0 : item.duration || 0), 0)
    });
  }

  document.getElementById("tracking-pill").textContent = settings.trackingEnabled ? "Tracking active" : "Tracking paused";
  document.getElementById("goal-minutes").value = settings.dailyGoalMinutes;
  document.getElementById("distraction-limit").value = settings.distractionSites.length;

  const goalSeconds = Math.max(1, settings.dailyGoalMinutes * 60);
  const activeToday = today.reduce((total, item) => total + (item.duration || 0), 0);
  const productivityToday = today.filter((item) => typeof item.productivityScore === "number");
  const productivityAverage = productivityToday.length ? productivityToday.reduce((total, item) => total + item.productivityScore, 0) / productivityToday.length : 0;
  const progress = Math.min(100, Math.round((activeToday / goalSeconds) * 100));

  document.getElementById("goal-progress").textContent = `${progress}%`;
  document.getElementById("current-streak").textContent = String(await computeStreak(activities));
  document.getElementById("daily-active").textContent = formatDuration(activeToday);
  document.getElementById("daily-score").textContent = productivityAverage ? productivityAverage.toFixed(1) : "0.0";

  drawCategoryChart(categoryCanvas, buildCategorySeries(today));
  drawTrendChart(trendCanvas, summaries);
  drawHeatmap(heatmapCanvas, buildHeatmapSeries(activities));
  drawSiteChart(sitesCanvas, buildSiteSeries(today));
  renderInsights(insightsList, today, summaries);
  renderRecent(recentGrid, today);
  if (!settings.onboardingAccepted) {
    document.getElementById("onboarding-modal").classList.add("open");
  }
}

/**
 * @param {Array<any>} activities
 * @returns {Promise<number>}
 */
async function computeStreak(activities) {
  const today = new Date();
  let streak = 0;
  for (let offset = 0; offset < 60; offset += 1) {
    const day = new Date();
    day.setDate(today.getDate() - offset);
    const dayKey = toIsoDateKey(day);
    const hasActivity = activities.some((item) => toIsoDateKey(item.startTime) === dayKey || toIsoDateKey(item.endTime) === dayKey);
    if (hasActivity) {
      streak += 1;
      continue;
    }
    if (offset > 0) {
      break;
    }
  }
  return streak;
}

/**
 * @param {Array<any>} activities
 * @returns {{label: string, value: number}[]}
 */
function buildCategorySeries(activities) {
  const totals = new Map();
  for (const item of activities) {
    const category = item.category || "other";
    totals.set(category, (totals.get(category) || 0) + (item.duration || 0));
  }
  return Array.from(totals.entries()).map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value);
}

/**
 * @param {Array<any>} activities
 * @returns {{hostname: string, seconds: number, visits: number}[]}
 */
function buildSiteSeries(activities) {
  const map = new Map();
  for (const item of activities) {
    const key = item.hostname || "unknown";
    const entry = map.get(key) || { hostname: key, seconds: 0, visits: 0 };
    entry.seconds += item.duration || 0;
    entry.visits += 1;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((left, right) => right.seconds - left.seconds).slice(0, 10);
}

/**
 * @param {Array<any>} activities
 * @returns {number[][]}
 */
function buildHeatmapSeries(activities) {
  const series = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const activity of activities) {
    const start = new Date(activity.startTime);
    const dayIndex = (start.getDay() + 6) % 7;
    const hour = start.getHours();
    series[dayIndex][hour] += activity.duration || 0;
  }
  return series;
}

/**
 * @param {HTMLElement} container
 * @param {{label: string, value: number}[]} categories
 * @returns {void}
 */
function renderInsights(container, today, summaries) {
  const totalToday = today.reduce((total, item) => total + (item.duration || 0), 0);
  const topSite = buildSiteSeries(today)[0]?.hostname || "No site data yet";
  const focusMinutes = Math.round(totalToday / 60);
  const insights = [
    `You spent ${focusMinutes} minutes in tracked browsing today.`,
    topSite === "No site data yet" ? "No dominant site showed up yet, which usually means short sessions and quick switching." : `Your top site today was ${topSite}.`,
    `Your 14-day productivity trend is built from ${summaries.length} daily samples.`
  ];
  container.innerHTML = insights.map((item) => `<div class="insight-item">${item}</div>`).join("");
}

/**
 * @param {HTMLElement} container
 * @param {Array<any>} activities
 * @returns {void}
 */
function renderRecent(container, activities) {
  container.innerHTML = activities.slice(0, 16).map((activity) => {
    const latestShot = Array.isArray(activity.screenshots) && activity.screenshots.length ? activity.screenshots[activity.screenshots.length - 1].thumbnail : "";
    const thumbMarkup = latestShot ? `<img src="${latestShot}" alt="${activity.hostname || activity.title || 'Activity thumbnail'}" />` : `<div style="height:88px;display:flex;align-items:center;justify-content:center;color:#94a3b8;">No screenshot</div>`;
    return `
      <article class="thumbnail">
        ${thumbMarkup}
        <div class="meta">
          <div style="font-weight:700;color:#e2e8f0;">${activity.hostname || activity.title || "Unknown site"}</div>
          <div>${formatDuration(activity.duration || 0)} · ${activity.category || "other"}</div>
        </div>
      </article>
    `;
  }).join("");
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number}[]} series
 * @returns {void}
 */
function drawCategoryChart(canvas, series) {
  drawPie(canvas, series.length ? series : [{ label: "other", value: 1 }]);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{key: string, label: string, active: number, score: number, heat: number}[]} series
 * @returns {void}
 */
function drawTrendChart(canvas, series) {
  const context = setupCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  context.strokeStyle = "rgba(148,163,184,0.16)";
  context.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = 20 + (height - 50) * (index / 4);
    context.beginPath();
    context.moveTo(12, y);
    context.lineTo(width - 12, y);
    context.stroke();
  }
  const maxScore = Math.max(1, ...series.map((item) => item.score || 0));
  context.strokeStyle = "#38bdf8";
  context.lineWidth = 3;
  context.beginPath();
  series.forEach((item, index) => {
    const x = 14 + (index / Math.max(1, series.length - 1)) * (width - 28);
    const y = height - 28 - ((item.score || 0) / maxScore) * (height - 60);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} heatmap
 * @returns {void}
 */
function drawHeatmap(canvas, heatmap) {
  const context = setupCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const cellWidth = (width - 40) / 24;
  const cellHeight = (height - 40) / 7;
  const maxValue = Math.max(1, ...heatmap.flat());
  heatmap.forEach((day, dayIndex) => {
    day.forEach((value, hour) => {
      const intensity = value / maxValue;
      context.fillStyle = `rgba(56, 189, 248, ${0.12 + intensity * 0.78})`;
      context.fillRect(20 + hour * cellWidth, 20 + dayIndex * cellHeight, cellWidth - 2, cellHeight - 2);
    });
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{hostname: string, seconds: number, visits: number}[]} series
 * @returns {void}
 */
function drawSiteChart(canvas, series) {
  const context = setupCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const maxValue = Math.max(1, ...series.map((item) => item.seconds));
  const barHeight = (height - 40) / Math.max(1, series.length);
  series.slice(0, 10).forEach((item, index) => {
    const y = 18 + index * barHeight;
    const barWidth = ((width - 160) * item.seconds) / maxValue;
    context.fillStyle = "rgba(56,189,248,0.28)";
    context.fillRect(140, y, width - 160, barHeight - 8);
    context.fillStyle = "#22c55e";
    context.fillRect(140, y, barWidth, barHeight - 8);
    context.fillStyle = "#e2e8f0";
    context.font = "12px system-ui";
    context.fillText(item.hostname, 12, y + 16);
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number}[]} series
 * @returns {void}
 */
function drawPie(canvas, series) {
  const context = setupCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const total = series.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = Math.min(width, height) / 3;
  let startAngle = -Math.PI / 2;
  const colors = ["#38bdf8", "#22c55e", "#f59e0b", "#a78bfa", "#ef4444", "#84cc16", "#f97316"];
  context.lineWidth = 1;
  series.forEach((item, index) => {
    const angle = (item.value / total) * Math.PI * 2;
    context.beginPath();
    context.moveTo(width / 2, height / 2);
    context.arc(width / 2, height / 2, radius, startAngle, startAngle + angle);
    context.closePath();
    context.fillStyle = colors[index % colors.length];
    context.fill();
    startAngle += angle;
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
function setupCanvas(canvas) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  context.scale(ratio, ratio);
  context.fillStyle = "rgba(2,6,23,0.38)";
  context.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);
  context.fillStyle = "#e2e8f0";
  return context;
}

document.getElementById("toggle-focus").addEventListener("click", async () => {
  const settings = await db.getSettings();
  await db.saveSettings({ focusModeEnabled: !settings.focusModeEnabled });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  await renderDashboard();
});
document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("save-goals").addEventListener("click", async () => {
  const dailyGoalMinutes = Number(document.getElementById("goal-minutes").value || 240);
  const distractionSites = Array.from({ length: Math.max(0, Number(document.getElementById("distraction-limit").value || 0)) }, (_, index) => `site-${index + 1}.example`);
  const update = { dailyGoalMinutes };
  if (distractionSites.length) {
    update.distractionSites = distractionSites;
  }
  await db.saveSettings(update);
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  await renderDashboard();
});
document.getElementById("accept-onboarding").addEventListener("click", async () => {
  const agreed = document.getElementById("agree-checkbox").checked;
  if (!agreed) {
    return;
  }
  const textOnly = document.getElementById("text-only-checkbox").checked;
  await db.saveSettings({ onboardingAccepted: true, screenshotEnabled: !textOnly });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  document.getElementById("onboarding-modal").classList.remove("open");
  await renderDashboard();
});

renderDashboard().catch(() => undefined);
