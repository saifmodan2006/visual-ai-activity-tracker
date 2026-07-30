# Visual AI Activity Tracker

A privacy-first Chrome Extension that helps the installing user monitor their own browsing activity with transparent local storage, optional screenshots, and optional AI-powered insights.

## Setup

1. Load `extension/` as an unpacked Chrome extension.
2. Open the extension, accept the onboarding prompt, and choose whether to enable screenshots.
3. Configure optional AI and cloud sync settings in `options/`.
4. Install and run `backend/` if you want server-side sync or analytics.

## Architecture

- `background.js` manages tab/session lifecycle, idle detection, screenshot scheduling, and cleanup.
- `content-script.js` injects the recording indicator, flash notices, and focus-mode overlay.
- `lib/db.js` stores everything locally in IndexedDB.
- `lib/ai-service.js` handles optional OpenAI or Gemini calls with local fallback.
- `offscreen/` performs screenshot capture and compression.
- `popup/`, `dashboard/`, and `options/` provide the user-facing controls and analytics views.

## Privacy Summary

- Tracking is only for the installing user’s own browsing activity.
- No keystrokes, clipboard contents, mouse movements, or network request bodies are captured.
- Screenshots are optional, compressed thumbnails only, and can be disabled permanently.
- Data stays local unless cloud sync is explicitly enabled.
- You can export or delete all data at any time.

See [PRIVACY.md](PRIVACY.md) for the full policy summary.

## Contributing

- Keep changes focused and privacy-preserving.
- Do not add third-party telemetry.
- Prefer local processing and explicit user control.
- Update the README and privacy policy when adding new data collection or storage behavior.
