---
phase: 07-tab-lifecycle-fix-multi-tab-storage-scoping
plan: "01"
subsystem: storage-scoping
tags: [tab-lifecycle, storage, chrome-extension, bug-fix]
dependency_graph:
  requires: []
  provides: [per-tab-storage-scoping, tab-cleanup-on-close, popup-tab-aware-read]
  affects: [manifest.json, service-worker.js, content-script.js, popup.js]
tech_stack:
  added: []
  patterns: [delegate-pattern, per-tab-storage-key, top-level-listener-registration]
key_files:
  created: []
  modified:
    - manifest.json
    - service-worker.js
    - content-script.js
    - popup.js
decisions:
  - "Delegate pattern chosen for content-script category writes — content scripts cannot access their own tab ID reliably; service worker has sender.tab.id as authoritative source"
  - "onRemoved registered at top level in service-worker.js — MV3 service workers re-register only top-level synchronous listeners on restart; nested registrations are lost"
  - "isWindowClosing NOT checked in onRemoved — each tab in a closing window fires onRemoved individually; cleanup always runs correctly"
  - "One-time migration removes stale currentVideoCategory key at startup — no-op if key absent; clears legacy state from pre-Phase-7 installs"
metrics:
  duration: "89 seconds"
  completed_date: "2026-02-26"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
---

# Phase 7 Plan 01: Per-Tab Storage Scoping Summary

Per-tab scoped storage key (`currentVideoCategory_${tabId}`) replaces the single shared `currentVideoCategory` key, with `chrome.tabs.onRemoved` cleanup and popup active-tab-aware reads. Fixes TABST-01 (stale popup after tab close), TABST-02 (wrong category with multiple YouTube tabs), and TABST-03 (non-YouTube tab close clearing YouTube state).

## What Changed in Each File

### manifest.json
- Added `"tabs"` to the `permissions` array alongside `"storage"`, `"webNavigation"`, `"activeTab"`
- The `"tabs"` permission is required for `chrome.tabs.onRemoved` to fire — `"activeTab"` alone provides only temporary per-invocation access

### service-worker.js
Two additions to the message handler, two top-level registrations:

1. **SET_VIDEO_CATEGORY handler** in `onMessage`: receives the category name from content script, writes `currentVideoCategory_${sender.tab.id}` to storage. Using `sender.tab.id` as the key component is correct and authoritative — content scripts cannot reliably self-identify their tab ID.

2. **CLEAR_VIDEO_CATEGORY handler** in `onMessage`: removes `currentVideoCategory_${sender.tab.id}` from storage on navigation away from a watch page.

3. **`chrome.tabs.onRemoved.addListener`** at top level (TABST-01): deletes `currentVideoCategory_${tabId}` when any tab closes. Registered at top level because MV3 service workers re-register only synchronous top-level listeners on wake from idle.

4. **One-time migration**: `chrome.storage.local.remove('currentVideoCategory')` at top level clears any stale unscoped key from pre-Phase-7 installs. No-op if absent.

### content-script.js
Two storage operations replaced with delegate messages:

1. Inside `initForVideo()`: `chrome.storage.local.set({ currentVideoCategory: name })` replaced with `chrome.runtime.sendMessage({ type: 'SET_VIDEO_CATEGORY', categoryName })` with `.catch(() => {})` guard.

2. Inside `YT_NAVIGATION` handler: `chrome.storage.local.remove('currentVideoCategory')` replaced with `chrome.runtime.sendMessage({ type: 'CLEAR_VIDEO_CATEGORY' })` with `.catch(() => {})` guard.

Zero unscoped `currentVideoCategory` references remain.

### popup.js
The `DOMContentLoaded` handler's category read replaced:

Before: `chrome.storage.local.get('currentVideoCategory')` — reads shared key regardless of active tab.

After: `chrome.tabs.query({ active: true, currentWindow: true })` → if `tab.url.includes('youtube.com/watch')` → reads `currentVideoCategory_${tab.id}`. If the active tab is not a YouTube watch page, the element is left blank (neutral state — TABST-03 correct behavior).

## Storage Key Migration

| Before | After |
|--------|-------|
| `currentVideoCategory` (single shared key) | `currentVideoCategory_${tabId}` (per-tab scoped key) |
| Overwritten on every watch page load | Written on video load, deleted on tab close |
| Popup reads shared key regardless of active tab | Popup reads key for active tab only |
| Non-YouTube tab close could trigger incorrect state | Non-YouTube tabs never have a scoped key — no interference |

## Pitfalls Avoided

1. **Top-level listener registration**: `chrome.tabs.onRemoved.addListener` is at the top level of service-worker.js — not inside `handleCategoryRequest` or any async function. MV3 service workers terminate after ~30s of inactivity and restart when needed. Only top-level synchronous registrations survive restarts. Nested registrations are permanently lost after the first worker termination cycle.

2. **tabs permission specificity**: `"activeTab"` grants temporary access to the currently-focused tab at the moment the user invokes the extension. It does NOT enable background access to tab metadata or `onRemoved` events. The `"tabs"` permission is required separately.

3. **Delegate pattern rationale**: Content scripts cannot use `chrome.tabs.getCurrent()` reliably on watch pages — it returns `undefined` in content script context in some Chrome versions. The service worker always receives `sender.tab.id` as a field on the `sender` object, making it the correct place to key storage by tab ID.

4. **isWindowClosing not checked**: When a browser window closes, Chrome fires `onRemoved` for each tab individually. The `isWindowClosing` flag on the `removeInfo` parameter is informational only — skipping cleanup when it is `true` would leave stale keys for every tab in the closing window. Cleanup always runs.

## Deviations from Plan

None — plan executed exactly as written. The cross-file verification check for `currentVideoCategory[^_]` in service-worker.js surfaces the intentional one-time migration removal line (`chrome.storage.local.remove('currentVideoCategory')`), which is the expected and documented behavior — it cleans up the old key, it is not using it as an active data store.

## Self-Check

**Files exist:**
- manifest.json: modified (tabs permission added)
- service-worker.js: modified (onRemoved, SET/CLEAR handlers, migration)
- content-script.js: modified (delegate messages)
- popup.js: modified (per-tab scoped read)

**Commits:**
- 2de01dd: feat(07-01): add tabs permission, onRemoved cleanup, SET/CLEAR_VIDEO_CATEGORY handlers
- 1bf4e6e: feat(07-01): delegate category storage writes to service worker in content-script.js
- 8c9a7bc: feat(07-01): update popup.js to read per-tab scoped category key
