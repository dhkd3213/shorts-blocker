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
let cachedState = null;

function isOff() {
  return cachedSettings && isOffActiveLocal(cachedSettings, Date.now());
}
function curUsageMs() {
  return cachedState?.todayUsageMs ?? 0;
}
function curLimitMs() {
  const base = cachedSettings?.dailyLimitMs ?? DEFAULT_LIMIT_MS;
  return base + (cachedState?.bonusMs ?? 0);
}

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ---- Shorts feed/sidebar suppression ----
function applyHideClass() {
  const s = cachedSettings;
  const hideEnabled = !s || s.hideShorts !== false; // default ON
  const shouldHide = hideEnabled && !isOff();
  document.documentElement.classList.toggle('shorts-blocker-nohide', !shouldHide);
}

// ---- masthead widget: [usage counter] [ON/OFF toggle] ----
let barEl = null;
let toggleEl = null;
let countEl = null;

function onToggleClick() {
  chrome.runtime.sendMessage({ type: isOff() ? 'turnOn' : 'setOff' }).catch(() => {});
  // storage.onChanged refreshes cache + re-renders
}

function renderToggle() {
  if (!toggleEl) return;
  const off = isOff();
  toggleEl.classList.toggle('sb-off', !!off);
  toggleEl.querySelector('.sb-t-label').textContent = off ? '쇼츠블럭 · OFF' : '쇼츠블럭 · ON';
  toggleEl.title = off ? '꺼짐 (1시간 후 자동 켜짐) — 클릭해서 켜기' : '켜짐 — 클릭해서 끄기';
}

function renderCount() {
  if (!countEl) return;
  const usage = curUsageMs();
  const limit = curLimitMs();
  const off = isOff();
  countEl.querySelector('.sb-c-txt').textContent = fmtClock(usage);
  countEl.querySelector('.sb-c-lim').textContent = fmtClock(limit);
  const pct = limit > 0 ? usage / limit : 0;
  let c = '#5ee08a';
  if (off) c = '#ffb15c';
  else if (pct >= 1) c = '#ff5563';
  else if (pct >= 0.7) c = '#ffb15c';
  const dot = countEl.querySelector('.sb-c-dot');
  dot.style.background = c;
  dot.style.color = c;
}

function ensureMastheadWidget() {
  if (barEl && document.contains(barEl)) return;
  const end = document.querySelector('ytd-masthead #end') || document.querySelector('#masthead #end');
  if (!end) return;
  barEl = document.createElement('div');
  barEl.id = 'sb-bar';
  barEl.innerHTML =
    '<div id="sb-count" title="오늘 쇼츠 시청 시간">' +
    '<span class="sb-c-dot"></span>' +
    '<span class="sb-c-txt">0:00</span>' +
    '<span class="sb-c-sep"> / </span>' +
    '<span class="sb-c-lim">10:00</span>' +
    '</div>' +
    '<button id="sb-toggle" type="button">' +
    '<span class="sb-t-dot"></span>' +
    '<span class="sb-t-label">쇼츠블럭 · ON</span>' +
    '</button>';
  toggleEl = barEl.querySelector('#sb-toggle');
  countEl = barEl.querySelector('#sb-count');
  toggleEl.addEventListener('click', onToggleClick);
  end.insertBefore(barEl, end.firstChild);
  renderToggle();
  renderCount();
}

// ---- init ----
(async () => {
  const obj = await chrome.storage.local.get(['state', 'settings']);
  cachedState = obj.state ?? null;
  cachedSettings = obj.settings ?? null;
  applyHideClass();
  ensureMastheadWidget();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    cachedSettings = changes.settings.newValue ?? null;
    applyHideClass();
    renderToggle();
    renderCount();
  }
  if (changes.state) {
    cachedState = changes.state.newValue ?? null;
    renderCount();
  }
});

// keep the widget present + correct across SPA navigations
setInterval(() => {
  ensureMastheadWidget();
  renderToggle();
  renderCount();
}, MAINT_INTERVAL_MS);

// count Shorts viewing time (only on /shorts/ while the tab is visible)
setInterval(() => {
  if (!isOnShorts()) return;
  if (document.visibilityState !== 'visible') return;
  chrome.runtime.sendMessage({ type: 'tick' }).catch(() => {});
}, TICK_INTERVAL_MS);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'block' && isOnShorts()) {
    const blockedUrl = chrome.runtime.getURL('src/blocked.html') + '?reason=limit';
    location.replace(blockedUrl);
  }
});
