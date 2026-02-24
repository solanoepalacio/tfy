# TFY — Topic Focused YouTube

Collapses off-topic sidebar suggestions on YouTube watch pages so only same-category videos remain visible — eliminating cross-interest distraction during focused research sessions.

---

## What it does

YouTube's sidebar surfaces whatever its recommendation engine favors at that moment. While watching a programming tutorial, you get gaming clips. While researching science, you get entertainment. The context switch is instant and the distraction is real.

TFY compares each sidebar suggestion's category against the current video's category using the YouTube Data API v3. Any sidebar item whose category does not match the current video is collapsed — visually hidden to a thin bar — rather than removed from the DOM. Each collapsed bar shows a label in the format `hidden: {Category} · {Title}` so you can see what was filtered without having to expand it. The YouTube Shorts shelf is unconditionally hidden on all watch pages, regardless of filtering state.

Filtering re-runs automatically when you navigate between videos through YouTube's SPA (single-page app) navigation — no page reload required. A popup toggle lets you disable or re-enable filtering instantly without reloading the page.

### How it works

1. When a YouTube watch page loads, the content script reads the current video ID from the URL.
2. A message is sent to the background service worker, which calls the YouTube Data API v3 with your API key to retrieve the video's category.
3. The service worker also fetches the category for each video visible in the sidebar.
4. Items whose category does not match the current video's category are collapsed in the DOM. Items in unknown categories (no API result) are left visible.
5. A `MutationObserver` watches for new sidebar items added by YouTube's lazy loading and filters them as they appear.

All API calls are made from the service worker, not the content script, because Chrome's Manifest V3 content scripts cannot call `googleapis.com` directly due to cross-origin restrictions.

---

## Agentic POC

> **TFY was built entirely by AI agents — Claude Code running a GSD (Get Shit Done) agentic workflow — with zero human-written code.**
>
> Every phase of the project was planned and executed by Claude agents: the extension scaffold, sidebar filtering logic, popup controls, observability and Shorts suppression, and this README. The human role was product direction only. TFY is an agentic engineering proof-of-concept demonstrating that a complete, functional Chrome extension can be produced end-to-end without a human developer writing a single line of code.

---

## Prerequisites

Before installing, make sure you have:

1. **Chrome browser** — TFY is a Manifest V3 Chrome extension; it runs in Chrome only.
2. **A Google Cloud project** with the YouTube Data API v3 enabled.
3. **A YouTube Data API v3 key** from that project.

To create a project and generate an API key, visit the [Google Cloud Console](https://console.cloud.google.com). The YouTube Data API v3 is available under APIs & Services.

---

## Install

No build step is required — TFY is a plain JavaScript extension with no compilation.

1. Clone the repository and enter the directory:
   ```
   git clone <repo-url> && cd tfy
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the `tfy` project folder (the directory containing `manifest.json`).
5. The TFY extension icon appears in the Chrome toolbar.

---

## Configure: Enter Your API Key

1. Click the TFY icon in the Chrome toolbar to open the popup.
2. Paste your YouTube Data API v3 key into the input field.
3. Click **Save**.
4. Navigate to any YouTube watch page (e.g., `https://www.youtube.com/watch?v=...`).
5. Open Chrome DevTools (`F12` or `Ctrl+Shift+I`) and check the console — you should see `[TFY]` log entries showing the detected video category and the filtering results.

The API key is stored in `chrome.storage.local` and persists across browser restarts. You only need to enter it once.

---

## Usage

Filtering is automatic. Once the API key is saved, TFY filters the sidebar on every YouTube watch page without any interaction required.

- **Collapsed items**: Off-topic sidebar suggestions are collapsed to a thin bar. Each bar shows a label — `hidden: {Category} · {Title}` — so you know what was filtered without expanding it.
- **Shorts suppression**: The YouTube Shorts shelf is hidden on all watch pages, regardless of the filtering toggle state.
- **Toggle**: Click the TFY popup icon and use the checkbox to disable or re-enable filtering instantly. You do not need to reload the page. The toggle state persists across browser restarts.
- **SPA navigation**: When you click to a new video without a full page reload (YouTube's default behavior), TFY automatically re-filters the sidebar for the new video.
