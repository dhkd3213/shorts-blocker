const TICK_INTERVAL_MS = 1000;

function isOnShorts() {
  return location.pathname.startsWith('/shorts/');
}

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!isOnShorts()) return;
  chrome.runtime.sendMessage({ type: 'tick' }).catch(() => {
    // Service worker may be restarting — silently drop this tick
  });
}, TICK_INTERVAL_MS);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'block' && isOnShorts()) {
    const blockedUrl = chrome.runtime.getURL('src/blocked.html') + '?reason=limit';
    location.replace(blockedUrl);
  }
});
