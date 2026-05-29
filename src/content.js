const TICK_INTERVAL_MS = 1000;

function isOnShorts() {
  return location.pathname.startsWith('/shorts/');
}

// Inline copy of isOffActive — content scripts can't import the ES module.
// Keep in sync with src/lib/state.js isOffActive().
function isOffActiveLocal(settings, nowMs) {
  const off = settings?.offUntil;
  if (off == null) return false;
  if (off === 'infinite') return true;
  return nowMs < off;
}

async function syncOffClass() {
  const obj = await chrome.storage.local.get('settings');
  const off = obj.settings && isOffActiveLocal(obj.settings, Date.now());
  document.documentElement.classList.toggle('shorts-blocker-off', !!off);
}

syncOffClass();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncOffClass();
});

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!isOnShorts()) return;
  chrome.runtime.sendMessage({ type: 'tick' }).catch(() => {});
}, TICK_INTERVAL_MS);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'block' && isOnShorts()) {
    const blockedUrl = chrome.runtime.getURL('src/blocked.html') + '?reason=limit';
    location.replace(blockedUrl);
  }
});
