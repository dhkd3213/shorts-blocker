const TICK_INTERVAL_MS = 1000;
const DEFAULT_LIMIT_MS = 10 * 60 * 1000;

function isOnShorts() {
  return location.pathname.startsWith('/shorts/');
}

// Inline copy of isOffActive — content scripts can't import the ES module.
// Keep in sync with src/lib/state.js isOffActive().
function isOffActiveLocal(settings, nowMs) {
  const off = settings?.offUntil;
  if (off == null) return false;
  return nowMs < off;
}

async function syncHideClass() {
  const obj = await chrome.storage.local.get('settings');
  const s = obj.settings;
  const off = s && isOffActiveLocal(s, Date.now());
  const hideEnabled = !s || s.hideShorts !== false; // default ON
  const shouldHide = hideEnabled && !off;
  // class "shorts-blocker-nohide" = do NOT hide the Shorts UI
  document.documentElement.classList.toggle('shorts-blocker-nohide', !shouldHide);
}

syncHideClass();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncHideClass();
});

// ---- on-page usage counter ----
let counterEl = null;

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function ensureCounter() {
  if (counterEl && document.body && document.body.contains(counterEl)) return counterEl;
  if (!document.body) return null;
  counterEl = document.createElement('div');
  counterEl.id = 'sb-counter';
  counterEl.innerHTML =
    '<span class="sb-dot"></span>' +
    '<span class="sb-txt">0:00</span>' +
    '<span class="sb-sep">/</span>' +
    '<span class="sb-lim">10:00</span>';
  document.body.appendChild(counterEl);
  return counterEl;
}

function renderCounter(usageMs, limitMs, off) {
  const el = ensureCounter();
  if (!el) return;
  el.querySelector('.sb-txt').textContent = fmtClock(usageMs);
  el.querySelector('.sb-lim').textContent = fmtClock(limitMs);
  const pct = limitMs > 0 ? usageMs / limitMs : 0;
  let c = '#4fd17a';
  if (off) c = '#ffb15c';
  else if (pct >= 1) c = '#ff5563';
  else if (pct >= 0.7) c = '#ffb15c';
  const dot = el.querySelector('.sb-dot');
  dot.style.background = c;
  dot.style.color = c; // drives the glow (box-shadow uses currentColor)
}

function showCounter(show) {
  const el = ensureCounter();
  if (el) el.style.display = show ? 'flex' : 'none';
}

// initial paint from storage (so it shows before the first tick response)
(async () => {
  const obj = await chrome.storage.local.get(['state', 'settings']);
  const usage = obj.state?.todayUsageMs ?? 0;
  const limit = (obj.settings?.dailyLimitMs ?? DEFAULT_LIMIT_MS) + (obj.state?.bonusMs ?? 0);
  const off = obj.settings && isOffActiveLocal(obj.settings, Date.now());
  if (isOnShorts()) {
    renderCounter(usage, limit, !!off);
    showCounter(true);
  }
})();

setInterval(async () => {
  const onShorts = isOnShorts();
  showCounter(onShorts);
  if (!onShorts) return;
  if (document.visibilityState !== 'visible') return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'tick' });
    if (resp?.ok) {
      const off = resp.offUntil != null && Date.now() < resp.offUntil;
      const limit = (resp.dailyLimitMs ?? DEFAULT_LIMIT_MS) + (resp.bonusMs ?? 0);
      renderCounter(resp.todayUsageMs, limit, off);
    }
  } catch {
    // service worker restarting — drop this tick
  }
}, TICK_INTERVAL_MS);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'block' && isOnShorts()) {
    const blockedUrl = chrome.runtime.getURL('src/blocked.html') + '?reason=limit';
    location.replace(blockedUrl);
  }
});
