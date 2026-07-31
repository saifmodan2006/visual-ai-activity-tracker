import { db } from "../lib/db.js";
import { formatDuration, toIsoDateKey, getCategoryColor, getCategoryIcon, getCategoryLabel } from "../lib/utils.js";
import { getEffectiveCategory } from "../lib/categorizer.js";

const categoryCanvas = document.getElementById("category-chart");
const heatmapCanvas = document.getElementById("heatmap-chart");
const trendCanvas = document.getElementById("trend-chart");
const sitesCanvas = document.getElementById("sites-chart");
const insightsList = document.getElementById("insights-list");
const recentGrid = document.getElementById("recent-grid");

let currentRange = "today"; // 'today', '7d', '30d'
let searchFilter = "";
let selectedCategoryFilter = "all";
let userSettings = {};

/**
 * Loads dashboard data and renders all charts and components.
 */
async function renderDashboard() {
  userSettings = await db.getSettings();
  if (userSettings.theme === "light") {
    document.body.classList.add("light-theme");
    document.body.setAttribute("data-theme", "light");
  } else {
    document.body.classList.remove("light-theme");
    document.body.setAttribute("data-theme", "dark");
  }

  const activities = await db.getRecentActivities(1000);
  const now = Date.now();
  const todayKey = toIsoDateKey(now);

  // Filter activities based on selected range
  let rangeActivities = [];
  if (currentRange === "today") {
    rangeActivities = activities.filter((item) => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
  } else if (currentRange === "7d") {
    const threshold = now - 7 * 24 * 60 * 60 * 1000;
    rangeActivities = activities.filter((item) => (item.startTime || 0) >= threshold);
  } else if (currentRange === "30d") {
    const threshold = now - 30 * 24 * 60 * 60 * 1000;
    rangeActivities = activities.filter((item) => (item.startTime || 0) >= threshold);
  }

  // 14-day history for trend chart
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

  // Top header status & goal inputs
  document.getElementById("tracking-pill").textContent = userSettings.trackingEnabled ? "Tracking active" : "Tracking paused";
  document.getElementById("tracking-pill").className = `pill ${userSettings.trackingEnabled ? 'primary' : 'warning'}`;
  document.getElementById("goal-minutes").value = userSettings.dailyGoalMinutes;
  document.getElementById("distraction-limit").value = (userSettings.distractionSites || []).length;

  const goalSeconds = Math.max(1, userSettings.dailyGoalMinutes * 60);
  const activeToday = activities.filter(item => toIsoDateKey(item.startTime) === todayKey).reduce((total, item) => total + (item.duration || 0), 0);
  const rangeActive = rangeActivities.reduce((total, item) => total + (item.duration || 0), 0);
  const productivityItems = rangeActivities.filter((item) => typeof item.productivityScore === "number");
  const productivityAverage = productivityItems.length ? productivityItems.reduce((total, item) => total + item.productivityScore, 0) / productivityItems.length : 0;
  const progress = Math.min(100, Math.round((activeToday / goalSeconds) * 100));

  document.getElementById("goal-progress").textContent = `${progress}%`;
  document.getElementById("current-streak").textContent = String(await computeStreak(activities));
  document.getElementById("daily-active").textContent = formatDuration(rangeActive);
  document.getElementById("daily-score").textContent = productivityAverage ? productivityAverage.toFixed(1) : "0.0";

  // Label updates according to range
  const rangeLabel = currentRange === "today" ? "Today" : currentRange === "7d" ? "Last 7 Days" : "Last 30 Days";
  document.getElementById("cat-range").textContent = rangeLabel;
  document.getElementById("sites-range").textContent = rangeLabel;

  // Render canvas charts
  drawCategoryChart(categoryCanvas, buildCategorySeries(rangeActivities));
  drawTrendChart(trendCanvas, summaries);
  drawHeatmap(heatmapCanvas, buildHeatmapSeries(activities));
  drawSiteChart(sitesCanvas, buildSiteSeries(rangeActivities));

  // Render text & list sections
  renderInsights(insightsList, rangeActivities, summaries);
  renderRecent(recentGrid, rangeActivities);

  if (!userSettings.onboardingAccepted) {
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
    const category = getEffectiveCategory(item, userSettings.customRules);
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
    const dayIndex = (start.getDay() + 6) % 7; // Mon = 0, Sun = 6
    const hour = start.getHours();
    series[dayIndex][hour] += activity.duration || 0;
  }
  return series;
}

/**
 * @param {HTMLElement} container
 * @param {Array<any>} rangeActivities
 * @param {Array<any>} summaries
 * @returns {void}
 */
function renderInsights(container, rangeActivities, summaries) {
  const totalSeconds = rangeActivities.reduce((total, item) => total + (item.duration || 0), 0);
  const topSite = buildSiteSeries(rangeActivities)[0]?.hostname || "No site data yet";
  const focusMinutes = Math.round(totalSeconds / 60);

  const workMinutes = Math.round(rangeActivities.filter(a => {
    const cat = getEffectiveCategory(a, userSettings.customRules);
    return cat === "work" || cat === "learning";
  }).reduce((s, a) => s + (a.duration || 0), 0) / 60);

  const socialMinutes = Math.round(rangeActivities.filter(a => {
    const cat = getEffectiveCategory(a, userSettings.customRules);
    return cat === "social" || cat === "entertainment";
  }).reduce((s, a) => s + (a.duration || 0), 0) / 60);

  const insights = [
    `⏱️ Total tracked activity: <strong>${focusMinutes} minutes</strong> in this window.`,
    `🎯 High-focus Work & Learning accounted for <strong>${workMinutes} minutes</strong>.`,
    topSite === "No site data yet" ? "No dominant site showed up yet." : `🌐 Your most active site was <strong>${topSite}</strong>.`,
    socialMinutes > 30 ? `💡 Social/Entertainment was ${socialMinutes} minutes. Turn on Focus Mode to boost deep work.` : `✅ Social/entertainment distraction remained low.`
  ];
  container.innerHTML = insights.map((item) => `<div style="border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--surface);font-size:13px;line-height:1.5;">${item}</div>`).join("");
}

/**
 * @param {HTMLElement} container
 * @param {Array<any>} activities
 * @returns {void}
 */
function renderRecent(container, activities) {
  let filtered = activities;

  if (selectedCategoryFilter !== "all") {
    filtered = filtered.filter(a => getEffectiveCategory(a, userSettings.customRules) === selectedCategoryFilter);
  }

  if (searchFilter.trim()) {
    const q = searchFilter.trim().toLowerCase();
    filtered = filtered.filter(a => (a.hostname || "").toLowerCase().includes(q) || (a.title || "").toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--muted);">No activity records match your search or filter criteria.</div>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 36).map((activity, idx) => {
    const category = getEffectiveCategory(activity, userSettings.customRules);
    const icon = getCategoryIcon(category);
    const color = getCategoryColor(category);
    const latestShot = Array.isArray(activity.screenshots) && activity.screenshots.length ? activity.screenshots[activity.screenshots.length - 1].thumbnail : "";
    const hostname = activity.hostname || activity.title || "Unknown site";

    let thumbMarkup = "";
    if (latestShot) {
      thumbMarkup = `<div style="position:relative;"><img src="${latestShot}" alt="${hostname}" data-index="${idx}" class="previewable" /><button class="delete-act-btn" data-id="${activity.id}" title="Delete session record" style="position:absolute;top:6px;right:6px;border:none;background:rgba(15,23,42,0.75);color:#ef4444;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;">✕</button></div>`;
    } else {
      // Visual placeholder card for entries without screenshots
      const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64` : '';
      thumbMarkup = `
        <div style="height:96px;position:relative;background:linear-gradient(135deg, ${color}25, rgba(15,23,42,0.85));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-bottom:1px solid var(--border);">
          <button class="delete-act-btn" data-id="${activity.id}" title="Delete session record" style="position:absolute;top:6px;right:6px;border:none;background:rgba(15,23,42,0.65);color:#ef4444;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;">✕</button>
          <img src="${faviconUrl}" onerror="this.style.display='none'" style="width:28px;height:28px;border-radius:6px;" alt="" />
          <span style="font-size:13px;font-weight:700;color:var(--text);">${icon} ${getCategoryLabel(category)}</span>
        </div>
      `;
    }

    return `
      <article class="thumbnail" data-id="${activity.id}">
        ${thumbMarkup}
        <div class="meta">
          <div style="font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${activity.title || hostname}">${hostname}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
            <span style="font-size:11px;color:${color};font-weight:700;">${icon} ${getCategoryLabel(category)}</span>
            <span style="font-size:11px;color:var(--muted);font-weight:600;">${formatDuration(activity.duration || 0)}</span>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // Attach click listeners for thumbnail preview
  container.querySelectorAll(".previewable").forEach(img => {
    img.addEventListener("click", (e) => {
      const idx = Number(e.target.getAttribute("data-index"));
      const item = filtered[idx];
      if (item && item.screenshots && item.screenshots.length) {
        openPreviewModal(item);
      }
    });
  });

  // Attach click listeners for delete activity record buttons
  container.querySelectorAll(".delete-act-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(e.target.getAttribute("data-id"));
      if (id) {
        await db.delete("activities", id);
        await renderDashboard();
      }
    });
  });
}

function openPreviewModal(activity) {
  const modal = document.getElementById("preview-modal");
  const title = document.getElementById("preview-title");
  const img = document.getElementById("preview-img");
  const meta = document.getElementById("preview-meta");

  const category = getEffectiveCategory(activity, userSettings.customRules);
  const shot = activity.screenshots[activity.screenshots.length - 1];
  title.textContent = `${activity.hostname} — ${activity.title || ''}`;
  img.src = shot.thumbnail;
  meta.textContent = `Recorded at ${new Date(shot.timestamp).toLocaleTimeString()} | Category: ${getCategoryLabel(category)} | Score: ${activity.productivityScore || 5}/10`;
  modal.classList.add("open");
}

document.getElementById("close-preview")?.addEventListener("click", () => {
  document.getElementById("preview-modal")?.classList.remove("open");
});

/**
 * High-DPI canvas drawing helper
 */
function setupCanvas(canvas) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);

  const isLight = document.body.classList.contains("light-theme");
  context.fillStyle = isLight ? "rgba(241,245,249,0.85)" : "rgba(2,6,23,0.45)";
  context.fillRect(0, 0, width, height);
  return { context, width, height };
}

function drawCategoryChart(canvas, series) {
  const { context, width, height } = setupCanvas(canvas);
  const total = series.reduce((sum, item) => sum + item.value, 0) || 1;
  const centerX = width / 3 + 10;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) / 2.6;
  const innerRadius = outerRadius * 0.55;

  let startAngle = -Math.PI / 2;
  series.forEach((item) => {
    const angle = (item.value / total) * Math.PI * 2;
    context.beginPath();
    context.arc(centerX, centerY, outerRadius, startAngle, startAngle + angle);
    context.arc(centerX, centerY, innerRadius, startAngle + angle, startAngle, true);
    context.closePath();
    context.fillStyle = getCategoryColor(item.label);
    context.fill();
    startAngle += angle;
  });

  // Legend list on the right side
  const isLight = document.body.classList.contains("light-theme");
  context.fillStyle = isLight ? "#0f172a" : "#e2e8f0";
  context.font = "12px Inter, system-ui";
  context.textAlign = "left";

  const legendX = width * 0.65;
  series.slice(0, 6).forEach((item, index) => {
    const y = 30 + index * 26;
    const color = getCategoryColor(item.label);
    context.fillStyle = color;
    context.beginPath();
    context.arc(legendX, y - 4, 5, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = isLight ? "#0f172a" : "#e2e8f0";
    const percent = Math.round((item.value / total) * 100);
    context.fillText(`${getCategoryLabel(item.label)} (${percent}%)`, legendX + 12, y);
  });
}

function drawTrendChart(canvas, series) {
  const { context, width, height } = setupCanvas(canvas);
  const isLight = document.body.classList.contains("light-theme");

  const paddingLeft = 30;
  const paddingBottom = 25;
  const graphWidth = width - paddingLeft - 15;
  const graphHeight = height - paddingBottom - 20;

  // Grid lines
  context.strokeStyle = isLight ? "rgba(203,213,225,0.4)" : "rgba(148,163,184,0.15)";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 15 + (graphHeight / 4) * i;
    context.beginPath();
    context.moveTo(paddingLeft, y);
    context.lineTo(width - 15, y);
    context.stroke();
  }

  const points = series.map((item, index) => {
    const x = paddingLeft + (index / Math.max(1, series.length - 1)) * graphWidth;
    const score = item.score || 5;
    const y = 15 + graphHeight - (score / 10) * graphHeight;
    return { x, y, label: item.label };
  });

  // Area fill under curve
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(56,189,248,0.35)");
  gradient.addColorStop(1, "rgba(56,189,248,0.0)");

  context.beginPath();
  context.moveTo(points[0].x, height - paddingBottom);
  points.forEach(p => context.lineTo(p.x, p.y));
  context.lineTo(points[points.length - 1].x, height - paddingBottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  // Curve line
  context.strokeStyle = "#38bdf8";
  context.lineWidth = 3;
  context.beginPath();
  points.forEach((p, i) => {
    if (i === 0) context.moveTo(p.x, p.y);
    else context.lineTo(p.x, p.y);
  });
  context.stroke();

  // Dots & X Axis Labels
  context.font = "10px Inter, system-ui";
  context.textAlign = "center";
  points.forEach((p, i) => {
    context.fillStyle = "#38bdf8";
    context.beginPath();
    context.arc(p.x, p.y, 4, 0, Math.PI * 2);
    context.fill();

    if (i % 2 === 0) {
      context.fillStyle = isLight ? "#64748b" : "#94a3b8";
      context.fillText(p.label, p.x, height - 6);
    }
  });
}

function drawHeatmap(canvas, heatmap) {
  const { context, width, height } = setupCanvas(canvas);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const isLight = document.body.classList.contains("light-theme");

  const leftMargin = 34;
  const topMargin = 20;
  const cellWidth = (width - leftMargin - 15) / 24;
  const cellHeight = (height - topMargin - 20) / 7;
  const maxValue = Math.max(1, ...heatmap.flat());

  context.font = "11px Inter, system-ui";
  context.textAlign = "right";
  context.fillStyle = isLight ? "#64748b" : "#94a3b8";

  // Y-axis day labels
  days.forEach((day, index) => {
    context.fillText(day, leftMargin - 6, topMargin + index * cellHeight + cellHeight / 1.5);
  });

  // Heatmap cells
  heatmap.forEach((day, dayIndex) => {
    day.forEach((value, hour) => {
      const intensity = value / maxValue;
      const x = leftMargin + hour * cellWidth;
      const y = topMargin + dayIndex * cellHeight;

      if (value > 0) {
        context.fillStyle = isLight
          ? `rgba(2, 132, 199, ${0.2 + intensity * 0.75})`
          : `rgba(56, 189, 248, ${0.15 + intensity * 0.8})`;
      } else {
        context.fillStyle = isLight ? "rgba(203, 213, 225, 0.3)" : "rgba(30, 41, 59, 0.4)";
      }
      context.fillRect(x, y, cellWidth - 2, cellHeight - 2);
    });
  });
}

function drawSiteChart(canvas, series) {
  const { context, width, height } = setupCanvas(canvas);
  const isLight = document.body.classList.contains("light-theme");

  if (!series || series.length === 0) {
    context.fillStyle = isLight ? "#64748b" : "#94a3b8";
    context.font = "13px Inter, system-ui";
    context.textAlign = "center";
    context.fillText("No site activity logged yet.", width / 2, height / 2);
    return;
  }

  const maxValue = Math.max(1, ...series.map((item) => item.seconds));
  const barHeight = (height - 30) / Math.max(1, Math.min(8, series.length));

  series.slice(0, 8).forEach((item, index) => {
    const y = 15 + index * barHeight;
    const maxBarW = width - 180;
    const barWidth = Math.max(6, (maxBarW * item.seconds) / maxValue);

    // Background track bar
    context.fillStyle = isLight ? "rgba(203,213,225,0.4)" : "rgba(30,41,59,0.5)";
    context.fillRect(150, y + 2, maxBarW, barHeight - 10);

    // Active duration bar
    const barGrad = context.createLinearGradient(150, y, 150 + barWidth, y);
    barGrad.addColorStop(0, "#38bdf8");
    barGrad.addColorStop(1, "#22c55e");
    context.fillStyle = barGrad;
    context.fillRect(150, y + 2, barWidth, barHeight - 10);

    // Site Hostname
    context.fillStyle = isLight ? "#0f172a" : "#e2e8f0";
    context.font = "12px Inter, system-ui";
    context.textAlign = "left";
    context.fillText(item.hostname.length > 18 ? item.hostname.slice(0, 16) + '...' : item.hostname, 12, y + barHeight / 2);

    // Duration Text
    context.fillStyle = isLight ? "#64748b" : "#94a3b8";
    context.font = "11px Inter, system-ui";
    context.fillText(formatDuration(item.seconds), 155 + barWidth + 6, y + barHeight / 2);
  });
}

// Range Selectors
document.querySelectorAll(".range-selector button").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    document.querySelectorAll(".range-selector button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentRange = e.target.getAttribute("data-range");
    await renderDashboard();
  });
});

// Category Filter Listener
document.getElementById("filter-category")?.addEventListener("change", (e) => {
  selectedCategoryFilter = e.target.value;
  db.getRecentActivities(1000).then(activities => {
    const todayKey = toIsoDateKey(Date.now());
    let rangeActivities = activities;
    if (currentRange === "today") {
      rangeActivities = activities.filter(item => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
    }
    renderRecent(recentGrid, rangeActivities);
  });
});

// Search Activity Filter
document.getElementById("search-activity")?.addEventListener("input", (e) => {
  searchFilter = e.target.value;
  db.getRecentActivities(1000).then(activities => {
    const todayKey = toIsoDateKey(Date.now());
    let rangeActivities = activities;
    if (currentRange === "today") {
      rangeActivities = activities.filter(item => toIsoDateKey(item.startTime) === todayKey || toIsoDateKey(item.endTime) === todayKey);
    }
    renderRecent(recentGrid, rangeActivities);
  });
});

document.getElementById("toggle-focus").addEventListener("click", async () => {
  const settings = await db.getSettings();
  await db.saveSettings({ focusModeEnabled: !settings.focusModeEnabled });
  await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  await renderDashboard();
});

document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("save-goals").addEventListener("click", async () => {
  const dailyGoalMinutes = Number(document.getElementById("goal-minutes").value || 240);
  const count = Number(document.getElementById("distraction-limit").value || 0);
  const settings = await db.getSettings();
  let sites = settings.distractionSites || [];
  if (sites.length < count) {
    sites = [...sites, ...Array.from({ length: count - sites.length }, (_, i) => `site-${i + 1}.com`)];
  } else if (sites.length > count) {
    sites = sites.slice(0, count);
  }
  await db.saveSettings({ dailyGoalMinutes, distractionSites: sites });
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
