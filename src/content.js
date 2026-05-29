const TICK_INTERVAL_MS = 1000;
const MAINT_INTERVAL_MS = 1000;
const POSITION_INTERVAL_MS = 300;
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

// ---- masthead ON/OFF toggle ----
let toggleEl = null;

function onToggleClick() {
  chrome.runtime.sendMessage({ type: isOff() ? 'turnOn' : 'setOff' }).catch(() => {});
}

function renderToggle() {
  if (!toggleEl) return;
  const off = isOff();
  toggleEl.classList.toggle('sb-off', !!off);
  toggleEl.querySelector('.sb-t-label').textContent = off ? '쇼츠블럭 · OFF' : '쇼츠블럭 · ON';
  toggleEl.title = off ? '꺼짐 (1시간 후 자동 켜짐) — 클릭해서 켜기' : '켜짐 — 클릭해서 끄기';
}

function ensureMastheadToggle() {
  if (toggleEl && document.contains(toggleEl)) return;
  const end = document.querySelector('ytd-masthead #end') || document.querySelector('#masthead #end');
  if (!end) return;
  toggleEl = document.createElement('button');
  toggleEl.id = 'sb-toggle';
  toggleEl.type = 'button';
  toggleEl.innerHTML = '<span class="sb-t-dot"></span><span class="sb-t-label">쇼츠블럭 · ON</span>';
  toggleEl.addEventListener('click', onToggleClick);
  end.insertBefore(toggleEl, end.firstChild);
  renderToggle();
}

// ---- on-video usage counter (tracks the active Shorts player's top-right) ----
let counterEl = null;

function ensureCounter() {
  if (counterEl && document.body && document.body.contains(counterEl)) return counterEl;
  if (!document.body) return null;
  counterEl = document.createElement('div');
  counterEl.id = 'sb-counter';
  counterEl.innerHTML =
    '<span class="sb-label">오늘 쇼츠 시청</span>' +
    '<span class="sb-time"><span class="sb-txt">0:00</span></span>';
  document.body.appendChild(counterEl);
  return counterEl;
}

function renderCounter() {
  const el = ensureCounter();
  if (!el) return;
  el.querySelector('.sb-txt').textContent = fmtClock(curUsageMs());
}

// Largest visible <video> = the active Shorts player.
function activeVideoRect() {
  let best = null;
  let bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) continue;
    const visW = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const visH = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const area = visW * visH;
    if (area > bestArea) {
      bestArea = area;
      best = r;
    }
  }
  return best;
}

function positionCounter() {
  const el = ensureCounter();
  if (!el) return;
  const rect = isOnShorts() ? activeVideoRect() : null;
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  // Sit just OUTSIDE the video's right edge, vertically centered (where the eyes are).
  const width = el.offsetWidth || 150;
  const height = el.offsetHeight || 56;
  let left = rect.right + 12;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(64, rect.top + rect.height / 2 - height / 2) + 'px';
  el.style.right = 'auto';
}

// ---- init ----
(async () => {
  const obj = await chrome.storage.local.get(['state', 'settings']);
  cachedState = obj.state ?? null;
  cachedSettings = obj.settings ?? null;
  applyHideClass();
  ensureMastheadToggle();
  renderCounter();
  positionCounter();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    cachedSettings = changes.settings.newValue ?? null;
    applyHideClass();
    renderToggle();
    renderCounter();
  }
  if (changes.state) {
    cachedState = changes.state.newValue ?? null;
    renderCounter();
  }
});

// keep masthead toggle present + values fresh across SPA navigations
setInterval(() => {
  ensureMastheadToggle();
  renderToggle();
  renderCounter();
}, MAINT_INTERVAL_MS);

// track the moving Shorts video (comments/sidebar open → video shifts)
setInterval(positionCounter, POSITION_INTERVAL_MS);
window.addEventListener('resize', positionCounter);

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
