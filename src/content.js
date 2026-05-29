const TICK_INTERVAL_MS = 1000;
const MAINT_INTERVAL_MS = 1500;
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

let cachedSettings = null;

function isOff() {
  return cachedSettings && isOffActiveLocal(cachedSettings, Date.now());
}

// ---- Shorts feed/sidebar suppression toggle ----
function applyHideClass() {
  const s = cachedSettings;
  const hideEnabled = !s || s.hideShorts !== false; // default ON
  const shouldHide = hideEnabled && !isOff();
  // class "shorts-blocker-nohide" = do NOT hide the Shorts UI
  document.documentElement.classList.toggle('shorts-blocker-nohide', !shouldHide);
}

// ---- masthead ON/OFF toggle (top-right of YouTube) ----
let toggleEl = null;

function onToggleClick() {
  chrome.runtime.sendMessage({ type: isOff() ? 'turnOn' : 'setOff' }).catch(() => {});
  // storage.onChanged refreshes cachedSettings + re-renders
}

function renderToggle() {
  if (!toggleEl) return;
  const off = isOff();
  const dot = toggleEl.querySelector('.sb-t-dot');
  const label = toggleEl.querySelector('.sb-t-label');
  const color = off ? '#ffb15c' : '#5ee08a';
  dot.style.background = color;
  dot.style.color = color;
  label.textContent = off ? '쇼츠블럭 · OFF' : '쇼츠블럭';
  toggleEl.title = off ? '꺼짐 (1시간 후 자동 켜짐) — 클릭해서 켜기' : '켜짐 — 클릭해서 끄기';
}

function ensureMastheadToggle() {
  if (toggleEl && document.contains(toggleEl)) return;
  const end = document.querySelector('ytd-masthead #end') || document.querySelector('#masthead #end');
  if (!end) return;
  toggleEl = document.createElement('button');
  toggleEl.id = 'sb-toggle';
  toggleEl.type = 'button';
  toggleEl.innerHTML = '<span class="sb-t-dot"></span><span class="sb-t-label">쇼츠블럭</span>';
  toggleEl.addEventListener('click', onToggleClick);
  end.insertBefore(toggleEl, end.firstChild);
  renderToggle();
}

// ---- on-page usage counter (Shorts only) ----
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
    '<div class="sb-body">' +
    '<span class="sb-label">오늘 쇼츠 시청</span>' +
    '<span class="sb-time"><span class="sb-txt">0:00</span><span class="sb-sep"> / </span><span class="sb-lim">10:00</span></span>' +
    '</div>';
  document.body.appendChild(counterEl);
  return counterEl;
}

function renderCounter(usageMs, limitMs, off) {
  const el = ensureCounter();
  if (!el) return;
  el.querySelector('.sb-txt').textContent = fmtClock(usageMs);
  el.querySelector('.sb-lim').textContent = fmtClock(limitMs);
  const pct = limitMs > 0 ? usageMs / limitMs : 0;
  let c = '#5ee08a';
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

// ---- init ----
(async () => {
  const obj = await chrome.storage.local.get(['state', 'settings']);
  cachedSettings = obj.settings ?? null;
  applyHideClass();
  ensureMastheadToggle();
  const usage = obj.state?.todayUsageMs ?? 0;
  const limit = (obj.settings?.dailyLimitMs ?? DEFAULT_LIMIT_MS) + (obj.state?.bonusMs ?? 0);
  if (isOnShorts()) {
    renderCounter(usage, limit, !!isOff());
    showCounter(true);
  }
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    cachedSettings = changes.settings.newValue ?? null;
    applyHideClass();
    renderToggle();
  }
});

// keep the masthead toggle present + correct across SPA navigations
setInterval(() => {
  ensureMastheadToggle();
  renderToggle();
}, MAINT_INTERVAL_MS);

// tick + counter
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
