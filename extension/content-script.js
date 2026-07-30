const INDICATOR_ID = "visual-ai-tracker-indicator";
const FLASH_ID = "visual-ai-tracker-flash";
const OVERLAY_ID = "visual-ai-focus-mode-overlay";
let indicatorState = "paused";
let sessionData = null;
let hideTimer = null;
let dragState = null;
let passwordFocusTimer = null;

/**
 * Initialize the page-level UI elements used for tracking transparency.
 */
function initIndicator() {
  if (document.getElementById(INDICATOR_ID)) {
    return;
  }
  const indicator = document.createElement("div");
  indicator.id = INDICATOR_ID;
  indicator.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:10px 12px",
    "border-radius:9999px",
    "background:rgba(15,23,42,0.92)",
    "color:#e2e8f0",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "font-size:12px",
    "line-height:1",
    "box-shadow:0 12px 30px rgba(15,23,42,0.35)",
    "backdrop-filter:blur(12px)",
    "transition:opacity 180ms ease, transform 180ms ease",
    "cursor:grab"
  ].join(";");
  indicator.innerHTML = `
    <span data-pill="state" style="display:inline-flex;align-items:center;gap:6px;font-weight:700;white-space:nowrap;">🔴 Recording</span>
    <span data-pill="duration" style="color:#cbd5e1;white-space:nowrap;">0m 00s</span>
    <button data-action="pause" style="border:none;border-radius:9999px;background:#ef4444;color:white;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">Pause</button>
    <button data-action="settings" style="border:none;border-radius:9999px;background:rgba(148,163,184,0.18);color:#e2e8f0;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">Settings</button>
  `;
  indicator.addEventListener("mouseenter", showIndicator);
  indicator.addEventListener("mouseleave", scheduleIndicatorFade);
  indicator.addEventListener("pointerdown", beginDrag);
  indicator.querySelector('[data-action="pause"]').addEventListener("click", toggleTrackingFromIndicator);
  indicator.querySelector('[data-action="settings"]').addEventListener("click", openOptionsPage);
  document.documentElement.appendChild(indicator);
  showIndicator();
  scheduleIndicatorFade();
}

/**
 * @returns {void}
 */
function showIndicator() {
  const indicator = document.getElementById(INDICATOR_ID);
  if (!indicator) {
    return;
  }
  indicator.style.opacity = "1";
  indicator.style.transform = "translateY(0) scale(1)";
  clearTimeout(hideTimer);
}

/**
 * @returns {void}
 */
function scheduleIndicatorFade() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const indicator = document.getElementById(INDICATOR_ID);
    if (indicator && indicatorState === "recording") {
      indicator.style.opacity = "0.78";
      indicator.style.transform = "translateY(-1px) scale(0.995)";
    }
  }, 5000);
}

/**
 * @param {PointerEvent} event
 * @returns {void}
 */
function beginDrag(event) {
  const indicator = document.getElementById(INDICATOR_ID);
  if (!indicator || event.button !== 0) {
    return;
  }
  dragState = {
    offsetX: event.clientX - indicator.getBoundingClientRect().left,
    offsetY: event.clientY - indicator.getBoundingClientRect().top
  };
  indicator.style.cursor = "grabbing";
  indicator.setPointerCapture(event.pointerId);
  const moveListener = (moveEvent) => {
    if (!dragState) {
      return;
    }
    indicator.style.left = `${Math.max(8, moveEvent.clientX - dragState.offsetX)}px`;
    indicator.style.top = `${Math.max(8, moveEvent.clientY - dragState.offsetY)}px`;
    indicator.style.right = "auto";
  };
  const upListener = () => {
    dragState = null;
    indicator.style.cursor = "grab";
    window.removeEventListener("pointermove", moveListener);
    window.removeEventListener("pointerup", upListener);
  };
  window.addEventListener("pointermove", moveListener);
  window.addEventListener("pointerup", upListener, { once: true });
}

/**
 * @returns {Promise<void>}
 */
async function toggleTrackingFromIndicator() {
  const response = await chrome.runtime.sendMessage({ type: "TOGGLE_TRACKING" });
  if (response?.trackingEnabled) {
    updateIndicatorState("recording", sessionData, response.settings);
  } else {
    updateIndicatorState("paused", sessionData, response?.settings);
  }
}

/**
 * @returns {Promise<void>}
 */
async function openOptionsPage() {
  await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
}

/**
 * @param {string} state
 * @param {any} session
 * @param {any} settings
 * @returns {void}
 */
function updateIndicatorState(state, session, settings) {
  indicatorState = state;
  sessionData = session || sessionData;
  const indicator = document.getElementById(INDICATOR_ID);
  if (!indicator) {
    return;
  }
  const stateNode = indicator.querySelector('[data-pill="state"]');
  const durationNode = indicator.querySelector('[data-pill="duration"]');
  const pauseButton = indicator.querySelector('[data-action="pause"]');
  const trackingEnabled = settings?.trackingEnabled ?? state === "recording";
  if (stateNode) {
    if (state === "recording") {
      stateNode.textContent = "🔴 Recording";
      indicator.style.background = "rgba(15,23,42,0.92)";
    } else if (state === "idle") {
      stateNode.textContent = "🟡 Idle";
      indicator.style.background = "rgba(120,53,15,0.92)";
    } else if (state === "incognito-paused") {
      stateNode.textContent = "⚪ Paused - Incognito";
      indicator.style.background = "rgba(71,85,105,0.92)";
    } else if (state === "focus-mode") {
      stateNode.textContent = "🟠 Focus Mode";
      indicator.style.background = "rgba(124,45,18,0.92)";
    } else {
      stateNode.textContent = "⚪ Paused";
      indicator.style.background = "rgba(51,65,85,0.92)";
    }
  }
  if (durationNode) {
    durationNode.textContent = session?.formattedDuration || "0m 00s";
  }
  if (pauseButton) {
    pauseButton.textContent = trackingEnabled ? "Pause" : "Resume";
  }
  scheduleIndicatorFade();
}

/**
 * @returns {void}
 */
function showFlash() {
  if (document.getElementById(FLASH_ID)) {
    return;
  }
  const flash = document.createElement("div");
  flash.id = FLASH_ID;
  flash.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,0.65);pointer-events:none;animation:visual-ai-flash 140ms ease-out forwards;";
  const style = document.createElement("style");
  style.textContent = "@keyframes visual-ai-flash { from { opacity: 0.95; } to { opacity: 0; } }";
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(flash);
  setTimeout(() => {
    flash.remove();
    style.remove();
  }, 160);
}

/**
 * @returns {void}
 */
function showFocusOverlay() {
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,23,0.95);display:flex;align-items:center;justify-content:center;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center;";
  overlay.innerHTML = `
    <div style="max-width:560px;border:1px solid rgba(148,163,184,0.18);border-radius:24px;background:rgba(15,23,42,0.92);padding:28px;box-shadow:0 30px 90px rgba(15,23,42,0.5);">
      <div style="font-size:18px;font-weight:800;margin-bottom:10px;">You're in Focus Mode. This site is blocked.</div>
      <p style="margin:0 0 20px 0;color:#cbd5e1;line-height:1.6;">Take a short break, switch back to your planned work, or pause Focus Mode if you really need to continue.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <button data-focus="break" style="border:none;border-radius:9999px;background:#f59e0b;color:#111827;padding:10px 14px;font-weight:800;cursor:pointer;">Take a Break - 5 min</button>
        <button data-focus="off" style="border:none;border-radius:9999px;background:#334155;color:#f8fafc;padding:10px 14px;font-weight:800;cursor:pointer;">Turn Off Focus Mode</button>
        <button data-focus="work" style="border:none;border-radius:9999px;background:#16a34a;color:white;padding:10px 14px;font-weight:800;cursor:pointer;">Back to Work</button>
      </div>
      <p style="margin-top:16px;font-size:12px;color:#94a3b8;">Emergency bypass requires three spaced clicks in the page corner.</p>
    </div>
  `;
  overlay.querySelector('[data-focus="break"]').addEventListener("click", () => chrome.runtime.sendMessage({ type: "FOCUS_BREAK" }));
  overlay.querySelector('[data-focus="off"]').addEventListener("click", () => chrome.runtime.sendMessage({ type: "DISABLE_FOCUS_MODE" }));
  overlay.querySelector('[data-focus="work"]').addEventListener("click", () => overlay.remove());
  document.documentElement.appendChild(overlay);
}

/**
 * @returns {void}
 */
function hideFocusOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * @param {FocusEvent} event
 * @returns {void}
 */
function handleFocusIn(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === "password") {
    clearTimeout(passwordFocusTimer);
    chrome.runtime.sendMessage({ type: "PASSWORD_FOCUS_START" });
    passwordFocusTimer = setTimeout(() => chrome.runtime.sendMessage({ type: "PASSWORD_FOCUS_END" }), 30000);
  }
}

/**
 * @param {MessageEvent} message
 * @returns {void}
 */
function handleMessage(message) {
  if (message.type === "TRACKER_STATE") {
    initIndicator();
    updateIndicatorState(message.state, message.session, message.settings);
    return;
  }
  if (message.type === "SCREENSHOT_FLASH") {
    showFlash();
    return;
  }
  if (message.type === "FOCUS_MODE_ON") {
    showFocusOverlay();
    return;
  }
  if (message.type === "FOCUS_MODE_OFF") {
    hideFocusOverlay();
  }
}

chrome.runtime.onMessage.addListener((message) => handleMessage(message));
document.addEventListener("focusin", handleFocusIn, true);
window.addEventListener("mousemove", () => {
  if (indicatorState === "recording") {
    showIndicator();
    scheduleIndicatorFade();
  }
}, { passive: true });
window.addEventListener("DOMContentLoaded", initIndicator, { once: true });
if (document.readyState !== "loading") {
  initIndicator();
}
