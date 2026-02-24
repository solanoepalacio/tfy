// popup.js — API key management + filtering toggle
// Uses chrome.storage.local (not localStorage — localStorage in content scripts
// writes to youtube.com's storage domain, not the extension's)

document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('api-key-input').value = apiKey;
    document.getElementById('status').textContent = 'API key loaded.';
  }

  const { filteringEnabled = true } = await chrome.storage.local.get('filteringEnabled');
  document.getElementById('toggle-filtering').checked = filteringEnabled;

  const { currentVideoCategory } = await chrome.storage.local.get('currentVideoCategory');
  if (currentVideoCategory) {
    document.getElementById('current-category').textContent = `Watching: ${currentVideoCategory}`;
  }
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) {
    document.getElementById('status').textContent = 'Please enter an API key.';
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  document.getElementById('status').textContent = 'Saved.';
});

document.getElementById('toggle-filtering').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ filteringEnabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes('youtube.com/watch')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TFY_TOGGLE', enabled }).catch(() => {});
  }
});
