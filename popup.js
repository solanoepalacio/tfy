// popup.js — API key management
// Uses chrome.storage.local (not localStorage — localStorage in content scripts
// writes to youtube.com's storage domain, not the extension's)

document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('api-key-input').value = apiKey;
    document.getElementById('status').textContent = 'API key loaded.';
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
