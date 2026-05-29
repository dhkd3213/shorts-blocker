# 쇼츠블럭 v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working v0.1 hardcoded extension into a deployable Korean-market Chrome extension with a configurable popup, a user-autonomy "Off" mechanic, a self-explaining block-page wait screen, and Web Store assets.

**Architecture:** Pure state logic in `src/lib/state.js` gains a `settings` parameter (daily limit + off state). The service worker migrates v0.1 data, owns `settings`, and answers new popup/block-page messages. A new popup controls limit + Off. CSS suppression toggles dynamically via a negation selector keyed on an `html.shorts-blocker-off` class.

**Tech Stack:** Chrome Manifest V3 · vanilla ES modules · `node:test` · no runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-29-shorts-blocker-v0.2-design.md`

---

## File Structure (delta from v0.1)

| Path | Change | Responsibility |
|---|---|---|
| `src/lib/state.js` | modify | settings-aware `applyTick` + `isOffActive`/`applyOff`/`turnOn`/`setLimit`/`defaultSettings` |
| `tests/state.test.js` | modify | thread `settings`, add helper tests |
| `src/background.js` | modify | migration, settings-aware tick, 4 new handlers, `off-expire` alarm |
| `src/content.js` | modify | `syncOffClass` dynamic suppression toggle |
| `src/content.css` | modify | negation selectors `html:not(.shorts-blocker-off)` |
| `src/popup.html/css/js` | create | popup UI |
| `src/blocked.html/css/js` | modify | rich "잠깐만요 ☕" wait card + data confirm |
| `manifest.json` | modify | name/version/description, `action`, `icons` |
| `icons/16,48,128.png` | create (user) | icon assets (user-provided) |
| `LICENSE` | create | MIT |
| `docs/privacy.html` | create | privacy policy (GitHub Pages) |
| `README.md` | modify | public-facing |

**Task order (dependency chain):** 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

## Task 1: `state.js` settings refactor (TDD)

**Files:**
- Modify: `src/lib/state.js`
- Modify: `tests/state.test.js`

- [ ] **Step 1.1: Replace `tests/state.test.js` with the full v0.2 test suite**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey,
  applyTick,
  startBypass,
  resetDay,
  isOffActive,
  applyOff,
  turnOn,
  setLimit,
  defaultSettings,
  DEFAULT_DAILY_LIMIT_MS,
  BYPASS_DURATION_MS,
  OFF_DURATIONS,
} from '../src/lib/state.js';

const baseSettings = () => ({ dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null });

test('todayKey formats local date as YYYY-MM-DD', () => {
  assert.equal(todayKey(new Date(2026, 4, 29)), '2026-05-29');
});

test('todayKey pads single-digit month and day', () => {
  assert.equal(todayKey(new Date(2026, 0, 3)), '2026-01-03');
});

test('applyTick increments todayUsageMs by tickMs', () => {
  const state = { todayUsageMs: 0, todayDateKey: '2026-05-29', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('applyTick reports blocked once default limit hit', () => {
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS - 1000, todayDateKey: '2026-05-29', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(blocked, true);
});

test('applyTick respects custom dailyLimitMs from settings', () => {
  const state = { todayUsageMs: 4000, todayDateKey: '2026-05-29', bypassUntil: null };
  const { blocked } = applyTick(state, { dailyLimitMs: 5000, offUntil: null }, new Date(2026, 4, 29, 10), 1000);
  assert.equal(blocked, true); // 5000 >= 5000
});

test('applyTick does not count or block during block-page bypass', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: now.getTime() + 60000 };
  const { state: next, blocked } = applyTick(state, baseSettings(), now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(blocked, false);
});

test('applyTick counts but does NOT block while Off is active', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() + 60000 };
  const { state: next, blocked } = applyTick(state, settings, now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS + 1000); // counts
  assert.equal(blocked, false); // no block
});

test('applyTick blocks immediately after Off expires when over limit', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS + 30000, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() - 1000 };
  const { blocked } = applyTick(state, settings, now, 1000);
  assert.equal(blocked, true);
});

test('applyTick infinite Off counts but never blocks', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS * 5, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: 'infinite' };
  const { state: next, blocked } = applyTick(state, settings, now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS * 5 + 1000);
  assert.equal(blocked, false);
});

test('applyTick safety-net resets when stored date is stale', () => {
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-28', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 0, 0, 5), 1000);
  assert.equal(next.todayDateKey, '2026-05-29');
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('isOffActive: null = not off', () => {
  assert.equal(isOffActive({ offUntil: null }, new Date(2026, 4, 29, 10)), false);
});
test('isOffActive: future timestamp = off', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(isOffActive({ offUntil: now.getTime() + 1000 }, now), true);
});
test('isOffActive: past timestamp = not off', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(isOffActive({ offUntil: now.getTime() - 1000 }, now), false);
});
test('isOffActive: "infinite" = off', () => {
  assert.equal(isOffActive({ offUntil: 'infinite' }, new Date(2026, 4, 29, 10)), true);
});

test('applyOff 15min sets offUntil to now + 15min', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(applyOff(baseSettings(), '15min', now).offUntil, now.getTime() + OFF_DURATIONS['15min']);
});
test('applyOff 1hour sets offUntil to now + 1hour', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(applyOff(baseSettings(), '1hour', now).offUntil, now.getTime() + OFF_DURATIONS['1hour']);
});
test('applyOff infinite sets offUntil to "infinite"', () => {
  assert.equal(applyOff(baseSettings(), 'infinite', new Date(2026, 4, 29, 10)).offUntil, 'infinite');
});

test('turnOn clears offUntil to null', () => {
  assert.equal(turnOn({ dailyLimitMs: 600000, offUntil: 'infinite' }).offUntil, null);
});
test('setLimit updates dailyLimitMs', () => {
  assert.equal(setLimit(baseSettings(), 300000).dailyLimitMs, 300000);
});
test('defaultSettings returns 10min limit and null off', () => {
  const s = defaultSettings();
  assert.equal(s.dailyLimitMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(s.offUntil, null);
});

test('startBypass sets bypassUntil = now + BYPASS_DURATION_MS', () => {
  const now = new Date(2026, 4, 29, 10);
  const next = startBypass({ todayUsageMs: 600000, todayDateKey: '2026-05-29', bypassUntil: null }, now);
  assert.equal(next.bypassUntil, now.getTime() + BYPASS_DURATION_MS);
});
test('resetDay zeros usage, clears bypass, updates date', () => {
  const next = resetDay({ todayUsageMs: 600000, todayDateKey: '2026-05-29', bypassUntil: 123 }, new Date(2026, 4, 30));
  assert.equal(next.todayUsageMs, 0);
  assert.equal(next.todayDateKey, '2026-05-30');
  assert.equal(next.bypassUntil, null);
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

Run: `npm test`
Expected: failures — `isOffActive`/`applyOff`/`turnOn`/`setLimit`/`defaultSettings`/`DEFAULT_DAILY_LIMIT_MS`/`OFF_DURATIONS` are not exported yet, and `applyTick` arity mismatch.

- [ ] **Step 1.3: Replace `src/lib/state.js` with the v0.2 implementation**

```js
export const DEFAULT_DAILY_LIMIT_MS = 10 * 60 * 1000;
export const BYPASS_DURATION_MS = 10 * 60 * 1000;
export const OFF_DURATIONS = { '15min': 15 * 60 * 1000, '1hour': 60 * 60 * 1000 };

export function todayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function defaultSettings() {
  return { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null };
}

export function isOffActive(settings, now) {
  const off = settings?.offUntil;
  if (off == null) return false;
  if (off === 'infinite') return true;
  return now.getTime() < off;
}

export function applyTick(state, settings, now, tickMs) {
  let working = state;
  const key = todayKey(now);
  if (working.todayDateKey !== key) {
    working = { ...working, todayUsageMs: 0, todayDateKey: key };
  }
  // block-page bypass: don't count, don't block
  if (working.bypassUntil && now.getTime() < working.bypassUntil) {
    return { state: working, blocked: false };
  }
  // Off: keep counting, never block
  const next = { ...working, todayUsageMs: working.todayUsageMs + tickMs };
  if (isOffActive(settings, now)) {
    return { state: next, blocked: false };
  }
  const limit = settings?.dailyLimitMs ?? DEFAULT_DAILY_LIMIT_MS;
  const blocked = next.todayUsageMs >= limit;
  return { state: next, blocked };
}

export function applyOff(settings, mode, now) {
  if (mode === 'infinite') return { ...settings, offUntil: 'infinite' };
  return { ...settings, offUntil: now.getTime() + OFF_DURATIONS[mode] };
}

export function turnOn(settings) {
  return { ...settings, offUntil: null };
}

export function setLimit(settings, limitMs) {
  return { ...settings, dailyLimitMs: limitMs };
}

export function startBypass(state, now) {
  return { ...state, bypassUntil: now.getTime() + BYPASS_DURATION_MS };
}

export function resetDay(state, now) {
  return { ...state, todayUsageMs: 0, todayDateKey: todayKey(now), bypassUntil: null };
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

Run: `npm test`
Expected: all tests pass, exit code 0.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/state.js tests/state.test.js
git commit -m "feat: settings-aware state logic (limit + Off mechanic)"
```

---

## Task 2: Service worker — migration, settings, new handlers

**Files:**
- Modify: `src/background.js` (full rewrite)

- [ ] **Step 2.1: Replace `src/background.js`**

```js
import {
  applyTick,
  startBypass,
  resetDay,
  todayKey,
  applyOff,
  turnOn,
  setLimit,
  isOffActive,
  defaultSettings,
} from './lib/state.js';

const STATE_KEY = 'state';
const SETTINGS_KEY = 'settings';
const SHORTS_URL_MATCH = '*://*.youtube.com/shorts/*';
const RESET_ALARM = 'daily-reset';
const OFF_ALARM = 'off-expire';

let queue = Promise.resolve();
function serialize(work) {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

function defaultState() {
  return { todayUsageMs: 0, todayDateKey: todayKey(new Date()), bypassUntil: null };
}

async function loadState() {
  const obj = await chrome.storage.local.get(STATE_KEY);
  return obj[STATE_KEY] ?? defaultState();
}
async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
async function loadSettings() {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  return obj[SETTINGS_KEY] ?? defaultSettings();
}
async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function migrateIfNeeded() {
  const obj = await chrome.storage.local.get(SETTINGS_KEY);
  if (!obj[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings() });
  }
}

async function broadcastBlock() {
  const tabs = await chrome.tabs.query({ url: SHORTS_URL_MATCH });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'block' }).catch(() => {});
  }
}

function scheduleMidnightAlarm() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  chrome.alarms.create(RESET_ALARM, { when: nextMidnight.getTime(), periodInMinutes: 1440 });
}

function scheduleOffExpire(offUntil) {
  if (typeof offUntil === 'number') {
    chrome.alarms.create(OFF_ALARM, { when: offUntil });
  } else {
    chrome.alarms.clear(OFF_ALARM);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleMidnightAlarm();
  migrateIfNeeded();
});
chrome.runtime.onStartup.addListener(() => {
  scheduleMidnightAlarm();
  migrateIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESET_ALARM) {
    serialize(async () => {
      const state = await loadState();
      await saveState(resetDay(state, new Date()));
    });
  } else if (alarm.name === OFF_ALARM) {
    serialize(async () => {
      const settings = await loadSettings();
      await saveSettings(turnOn(settings));
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  serialize(async () => {
    try {
      if (msg?.type === 'tick') {
        const [state, settings] = await Promise.all([loadState(), loadSettings()]);
        const { state: next, blocked } = applyTick(state, settings, new Date(), 1000);
        await saveState(next);
        if (blocked) await broadcastBlock();
        sendResponse({ ok: true, todayUsageMs: next.todayUsageMs, blocked });
      } else if (msg?.type === 'bypass') {
        const state = await loadState();
        await saveState(startBypass(state, new Date()));
        sendResponse({ ok: true });
      } else if (msg?.type === 'getStatus') {
        const [state, settings] = await Promise.all([loadState(), loadSettings()]);
        sendResponse({ ok: true, ...state, ...settings, now: Date.now() });
      } else if (msg?.type === 'setLimit') {
        const settings = await loadSettings();
        const updated = setLimit(settings, msg.limitMs);
        await saveSettings(updated);
        const state = await loadState();
        if (!isOffActive(updated, new Date()) && state.todayUsageMs >= updated.dailyLimitMs) {
          await broadcastBlock();
        }
        sendResponse({ ok: true });
      } else if (msg?.type === 'setOff') {
        const settings = await loadSettings();
        const updated = applyOff(settings, msg.mode, new Date());
        await saveSettings(updated);
        scheduleOffExpire(updated.offUntil);
        sendResponse({ ok: true });
      } else if (msg?.type === 'turnOn') {
        const settings = await loadSettings();
        await saveSettings(turnOn(settings));
        chrome.alarms.clear(OFF_ALARM);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  });
  return true;
});
```

- [ ] **Step 2.2: Syntax check**

Run: `node --check src/background.js`
Expected: exit 0 (no parse errors; `import`-related CLI complaints are fine — Chrome loads it as a module).

- [ ] **Step 2.3: Commit**

```bash
git add src/background.js
git commit -m "feat: service worker settings migration, Off handlers, off-expire alarm"
```

---

## Task 3: Content script — dynamic UI suppression

**Files:**
- Modify: `src/content.js` (full rewrite)
- Modify: `src/content.css` (full rewrite)

- [ ] **Step 3.1: Replace `src/content.js`**

```js
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
```

- [ ] **Step 3.2: Replace `src/content.css`**

```css
/* Hidden only while ON (no .shorts-blocker-off class on <html>) */

html:not(.shorts-blocker-off) ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) {
  display: none !important;
}
html:not(.shorts-blocker-off) ytd-reel-shelf-renderer {
  display: none !important;
}
html:not(.shorts-blocker-off) ytd-guide-entry-renderer a[title="Shorts"],
html:not(.shorts-blocker-off) ytd-guide-entry-renderer a[title="쇼츠"] {
  display: none !important;
}
html:not(.shorts-blocker-off) ytd-mini-guide-entry-renderer[aria-label="Shorts"],
html:not(.shorts-blocker-off) ytd-mini-guide-entry-renderer[aria-label="쇼츠"] {
  display: none !important;
}
```

- [ ] **Step 3.3: Syntax check content.js**

Run: `node --check src/content.js`
Expected: exit 0.

- [ ] **Step 3.4: Commit**

```bash
git add src/content.js src/content.css
git commit -m "feat: dynamic Shorts UI suppression toggled by Off state"
```

---

## Task 4: Popup UI + manifest `action`

**Files:**
- Create: `src/popup.html`, `src/popup.css`, `src/popup.js`
- Modify: `manifest.json` (name, version, description, `action`)

- [ ] **Step 4.1: Create `src/popup.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div class="popup">
    <header class="head">
      <span class="brand">쇼츠블럭</span>
      <span id="status-badge" class="badge">…</span>
    </header>

    <section class="usage">
      <div class="usage-label">오늘 사용 <span id="usage-note"></span></div>
      <div class="usage-value" id="usage-text">…</div>
      <div class="bar"><div id="usage-bar" class="bar-fill"></div></div>
    </section>

    <section class="limit">
      <div class="limit-label">하루 한도 · <span id="limit-value">10분</span></div>
      <input id="limit-slider" type="range" min="1" max="120" value="10" />
    </section>

    <section class="controls">
      <div id="on-controls">
        <button id="off-btn" class="btn" type="button">Off ▾</button>
        <div id="off-menu" class="off-menu hidden">
          <button data-mode="15min" class="off-opt" type="button">15분</button>
          <button data-mode="1hour" class="off-opt" type="button">1시간</button>
          <button data-mode="infinite" class="off-opt" type="button">무제한</button>
        </div>
      </div>
      <button id="on-btn" class="btn primary hidden" type="button">▶ 다시 켜기</button>
    </section>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4.2: Create `src/popup.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  width: 320px;
  background: #161616;
  color: #f0f0f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.popup { padding: 16px; display: flex; flex-direction: column; gap: 16px; }

.head { display: flex; align-items: center; justify-content: space-between; }
.brand { font-size: 16px; font-weight: 700; }
.badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
.badge.on { background: #1f3d1f; color: #7CFC7C; }
.badge.off { background: #3d2a1f; color: #ffb15c; }

.usage, .limit, .controls { background: #232323; border-radius: 12px; padding: 14px; }

.usage-label, .limit-label { font-size: 12px; color: #aaa; margin-bottom: 6px; }
#usage-note { color: #ffb15c; }
.usage-value { font-size: 20px; font-weight: 700; margin-bottom: 10px; }

.bar { height: 8px; background: #333; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; width: 0%; background: #ff4d4d; transition: width 0.3s ease; }
.bar-fill.over { background: #ff8a3d; }

#limit-slider { width: 100%; accent-color: #ff4d4d; margin-top: 4px; }

.controls { position: relative; }
.btn {
  width: 100%; padding: 12px; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
  background: #3a3a3a; color: #ddd;
}
.btn.primary { background: #ff4d4d; color: #fff; }
.btn:hover { opacity: 0.88; }

.off-menu { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.off-opt {
  padding: 10px; border: none; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-family: inherit; background: #2c2c2c; color: #ddd;
}
.off-opt:hover { background: #383838; }

.hidden { display: none !important; }
```

- [ ] **Step 4.3: Create `src/popup.js`**

```js
const $ = (id) => document.getElementById(id);

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m === 0 ? `${s}초` : `${m}분 ${s}초`;
}

function fmtLimitLabel(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
}

function offState(s) {
  const off = s.offUntil;
  if (off == null) return { active: false };
  if (off === 'infinite') return { active: true, infinite: true };
  const remaining = off - s.now;
  if (remaining <= 0) return { active: false };
  return { active: true, infinite: false, remainingMs: remaining };
}

let status = null;

async function refresh() {
  status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  render();
}

function render() {
  if (!status?.ok) return;
  const limitMin = Math.round(status.dailyLimitMs / 60000);
  const off = offState(status);

  if (off.active) {
    $('status-badge').textContent = off.infinite ? 'OFF' : `OFF · ${Math.ceil(off.remainingMs / 60000)}분`;
    $('status-badge').className = 'badge off';
  } else {
    $('status-badge').textContent = '✓ ON';
    $('status-badge').className = 'badge on';
  }

  $('usage-note').textContent = off.active ? '(Off 중에도 카운트)' : '';
  $('usage-text').textContent = `${fmtDuration(status.todayUsageMs)} / ${fmtLimitLabel(limitMin)}`;
  const pct = status.dailyLimitMs > 0 ? (status.todayUsageMs / status.dailyLimitMs) * 100 : 0;
  $('usage-bar').style.width = Math.min(100, pct) + '%';
  $('usage-bar').classList.toggle('over', pct >= 100);

  $('limit-slider').value = limitMin;
  $('limit-value').textContent = fmtLimitLabel(limitMin);

  $('on-controls').classList.toggle('hidden', off.active);
  $('on-btn').classList.toggle('hidden', !off.active);
  $('off-menu').classList.add('hidden');
}

$('limit-slider').addEventListener('input', () => {
  $('limit-value').textContent = fmtLimitLabel(Number($('limit-slider').value));
});
$('limit-slider').addEventListener('change', async () => {
  const min = Number($('limit-slider').value);
  await chrome.runtime.sendMessage({ type: 'setLimit', limitMs: min * 60000 });
  refresh();
});

$('off-btn').addEventListener('click', () => {
  $('off-menu').classList.toggle('hidden');
});
document.querySelectorAll('.off-opt').forEach((b) => {
  b.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'setOff', mode: b.dataset.mode });
    refresh();
  });
});

$('on-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'turnOn' });
  refresh();
});

refresh();
setInterval(refresh, 30000);
```

- [ ] **Step 4.4: Update `manifest.json`** — change `name`, `version`, `description`, add `action`. Replace the existing top fields and insert `action` after `host_permissions`. Final manifest (icons added later in Task 6):

```json
{
  "manifest_version": 3,
  "name": "쇼츠블럭",
  "version": "0.2.0",
  "description": "유튜브 쇼츠 시청 시간을 하루 N분으로 제한하고, 홈·사이드바의 쇼츠 진입점을 숨겨주는 확장 프로그램입니다.",
  "permissions": ["storage", "alarms", "tabs"],
  "host_permissions": ["*://*.youtube.com/*"],
  "action": {
    "default_popup": "src/popup.html",
    "default_title": "쇼츠블럭"
  },
  "background": { "service_worker": "src/background.js", "type": "module" },
  "content_scripts": [
    { "matches": ["*://*.youtube.com/*"], "js": ["src/content.js"], "css": ["src/content.css"], "run_at": "document_start" }
  ],
  "web_accessible_resources": [
    { "resources": ["src/blocked.html", "src/blocked.js", "src/blocked.css"], "matches": ["*://*.youtube.com/*"] }
  ]
}
```

- [ ] **Step 4.5: Validate manifest JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4.6: Manual verify (user, in Chrome)** — SKIP for subagent; record as user-verification:
  1. Reload extension at `chrome://extensions`
  2. Click the toolbar icon → popup opens, shows 오늘 사용 / 한도 슬라이더 / Off 버튼
  3. Drag slider → label updates live; release → reopening popup keeps the new value
  4. Off → 15분 → badge shows `OFF · 15분`, "다시 켜기" appears
  5. 다시 켜기 → back to `✓ ON`

- [ ] **Step 4.7: Commit**

```bash
git add src/popup.html src/popup.css src/popup.js manifest.json
git commit -m "feat: popup UI for usage, daily limit, and Off control"
```

---

## Task 5: Block page redesign — wait card + data confirm

**Files:**
- Modify: `src/blocked.html`, `src/blocked.css`, `src/blocked.js`

- [ ] **Step 5.1: Replace `src/blocked.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>오늘 한도 끝</title>
  <link rel="stylesheet" href="blocked.css" />
</head>
<body>
  <main id="block-card" class="card">
    <h1 class="title">쇼츠는 그만 🛑</h1>
    <p class="sub">오늘 한도를 다 썼어요.</p>
    <p class="countdown">자정까지 <span id="time-left">계산 중…</span> 남음</p>
    <div class="actions">
      <a href="https://www.youtube.com" class="btn primary">YouTube 홈으로</a>
      <button id="bypass-btn" class="btn secondary" type="button">10분만 더 보기</button>
    </div>
  </main>

  <main id="wait-card" class="card hidden">
    <h1 class="title">잠깐만요 ☕</h1>
    <p class="sub">보통 30초만 지나면<br>'꼭 봐야지' 느낌이 사라져요</p>
    <div class="divider"></div>
    <p class="usage-label">오늘 시청 시간</p>
    <p class="usage-value" id="wait-usage">…</p>
    <div class="bar"><div id="wait-usage-bar" class="bar-fill"></div></div>
    <div class="divider"></div>
    <p class="wait-count"><span id="wait-seconds">30</span>초</p>
    <div class="bar"><div id="wait-progress" class="bar-fill countdown-fill"></div></div>
    <button id="wait-continue" class="btn secondary hidden" type="button">계속하기</button>
  </main>

  <script src="blocked.js"></script>
</body>
</html>
```

- [ ] **Step 5.2: Replace `src/blocked.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #161616;
  color: #f0f0f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  padding: 24px;
}

.card {
  max-width: 480px;
  width: 100%;
  padding: 48px 40px;
  background: #232323;
  border-radius: 16px;
  text-align: center;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
}

.title { font-size: 28px; margin-bottom: 16px; }
.sub { font-size: 16px; color: #c0c0c0; margin-bottom: 24px; line-height: 1.5; }
.countdown { font-size: 14px; color: #909090; margin-bottom: 32px; }
#time-left { color: #f0f0f0; font-weight: 600; }

.actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.btn {
  padding: 12px 24px; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  text-decoration: none; font-family: inherit; transition: opacity 0.15s ease;
}
.btn:hover { opacity: 0.85; }
.btn.primary { background: #ff4d4d; color: white; }
.btn.secondary { background: #3a3a3a; color: #d0d0d0; }
.btn:disabled { background: #2a2a2a; color: #666; cursor: not-allowed; opacity: 1; }

/* Wait card */
.divider { height: 1px; background: #3a3a3a; margin: 20px 0; }
.usage-label { font-size: 13px; color: #909090; margin-bottom: 6px; }
.usage-value { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
.wait-count { font-size: 32px; font-weight: 700; margin-bottom: 12px; }
.bar { height: 8px; background: #333; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; width: 0%; background: #ff4d4d; transition: width 0.3s ease; }
.countdown-fill { background: #5c9eff; transition: width 1s linear; }
#wait-continue { margin-top: 24px; }

.hidden { display: none !important; }
```

- [ ] **Step 5.3: Replace `src/blocked.js`**

```js
const BYPASS_COUNTDOWN_S = 30;

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m === 0 ? `${s}초` : `${m}분 ${s}초`;
}

let statusData = null;

async function loadStatus() {
  try {
    statusData = await chrome.runtime.sendMessage({ type: 'getStatus' });
  } catch {
    statusData = null;
  }
}

function updateMidnightCountdown() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = midnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const el = document.getElementById('time-left');
  if (el) el.textContent = `${hours}시간 ${minutes}분`;
}

const blockCard = document.getElementById('block-card');
const waitCard = document.getElementById('wait-card');
const bypassBtn = document.getElementById('bypass-btn');
const continueBtn = document.getElementById('wait-continue');

function startWait() {
  if (statusData?.ok) {
    document.getElementById('wait-usage').textContent = fmtDuration(statusData.todayUsageMs);
    const pct = statusData.dailyLimitMs > 0 ? (statusData.todayUsageMs / statusData.dailyLimitMs) * 100 : 0;
    document.getElementById('wait-usage-bar').style.width = Math.min(100, pct) + '%';
  }
  blockCard.classList.add('hidden');
  waitCard.classList.remove('hidden');

  let remaining = BYPASS_COUNTDOWN_S;
  const secEl = document.getElementById('wait-seconds');
  const progEl = document.getElementById('wait-progress');
  secEl.textContent = remaining;
  progEl.style.width = '100%';

  const interval = setInterval(() => {
    remaining -= 1;
    secEl.textContent = Math.max(0, remaining);
    progEl.style.width = (Math.max(0, remaining) / BYPASS_COUNTDOWN_S * 100) + '%';
    if (remaining <= 0) {
      clearInterval(interval);
      continueBtn.classList.remove('hidden');
    }
  }, 1000);
}

async function confirmBypass() {
  const usageStr = statusData?.ok ? fmtDuration(statusData.todayUsageMs) : '';
  const firstMsg = usageStr
    ? `오늘 이미 ${usageStr} 봤는데, 정말 더 보시겠어요?`
    : '정말 더 보시겠어요?';
  if (!confirm(firstMsg)) { location.reload(); return; }
  if (!confirm('후회 안 할 자신 있어요?')) { location.reload(); return; }
  const res = await chrome.runtime.sendMessage({ type: 'bypass' });
  if (res?.ok) {
    location.href = 'https://www.youtube.com/shorts';
  } else {
    alert('우회 실패: ' + (res?.error ?? 'unknown'));
  }
}

bypassBtn.addEventListener('click', startWait);
continueBtn.addEventListener('click', confirmBypass);

(async () => {
  await loadStatus();
  updateMidnightCountdown();
  setInterval(updateMidnightCountdown, 30000);
})();
```

- [ ] **Step 5.4: Syntax check**

Run: `node --check src/blocked.js`
Expected: exit 0.

- [ ] **Step 5.5: Manual verify (user, in Chrome)** — SKIP for subagent:
  1. Force limit: in SW console `await chrome.storage.local.set({ state: { todayUsageMs: 595000, todayDateKey: new Date().toLocaleDateString('sv'), bypassUntil: null } })`
  2. Visit `youtube.com/shorts` → redirected to block page
  3. Click "10분만 더 보기" → wait card shows "잠깐만요 ☕" + 오늘 시청 시간 + 30s countdown bar
  4. After 30s → "계속하기" button appears
  5. Click → confirm "오늘 이미 …분 …초 봤는데, 정말 더 보시겠어요?" → second confirm → lands on `/shorts`

- [ ] **Step 5.6: Commit**

```bash
git add src/blocked.html src/blocked.css src/blocked.js
git commit -m "feat: block-page wait card with usage data and softer confirm copy"
```

---

## Task 6: Icons + LICENSE + manifest `icons` key

**Files:**
- Create (user): `icons/16.png`, `icons/48.png`, `icons/128.png`
- Create: `LICENSE`
- Modify: `manifest.json` (add `icons` + `action.default_icon`)

> **Blocking precondition:** the three icon PNGs must exist before adding the `icons` key, or Chrome shows a load warning. The user provides them (cracked-Shorts design, decision C). If they are not present, the subagent reports BLOCKED with: "Waiting for user to place icons/16.png, icons/48.png, icons/128.png."

- [ ] **Step 6.1: Verify icon files exist**

Run: `ls icons/16.png icons/48.png icons/128.png`
Expected: all three listed. If any missing → STOP, report BLOCKED (user must supply icons).

- [ ] **Step 6.2: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 dhkd3213

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6.3: Add `icons` and `action.default_icon` to `manifest.json`**

Insert top-level `icons` (after `host_permissions`) and `default_icon` inside `action`. Final `action` + `icons` portion:

```json
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },
  "action": {
    "default_popup": "src/popup.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png" },
    "default_title": "쇼츠블럭"
  },
```

- [ ] **Step 6.4: Validate manifest JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 6.5: Commit**

```bash
git add manifest.json LICENSE icons/
git commit -m "feat: add icons, action icon, and MIT license"
```

---

## Task 7: Privacy policy + README

**Files:**
- Create: `docs/privacy.html`
- Modify: `README.md` (full rewrite)

- [ ] **Step 7.1: Create `docs/privacy.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>쇼츠블럭 개인정보 처리방침</title>
  <style>
    body { max-width: 680px; margin: 40px auto; padding: 0 20px;
           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           line-height: 1.7; color: #222; }
    h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 28px; }
    code { background: #f3f3f3; padding: 2px 5px; border-radius: 4px; }
    .muted { color: #888; font-size: 13px; }
  </style>
</head>
<body>
  <h1>쇼츠블럭 개인정보 처리방침</h1>
  <p>쇼츠블럭(Shorts Blocker)은 사용자의 어떤 개인정보도 수집하거나 외부로 전송하지 않습니다.</p>

  <h2>저장되는 데이터</h2>
  <ul>
    <li>오늘 쇼츠 시청 시간, 하루 한도, Off 상태만 <code>chrome.storage.local</code>(브라우저 로컬)에 저장됩니다.</li>
    <li>이 데이터는 사용자의 기기를 벗어나지 않습니다.</li>
  </ul>

  <h2>수집하지 않는 것</h2>
  <ul>
    <li>개인 식별 정보(이름, 이메일, 계정 등)</li>
    <li>시청 기록, 검색어, 방문 URL</li>
    <li>광고 식별자 / 추적 쿠키</li>
  </ul>

  <h2>외부 전송 / 제3자 제공</h2>
  <p>없음. 분석 도구, 광고 SDK, 외부 서버 통신을 일절 사용하지 않습니다.</p>

  <h2>소스 코드</h2>
  <p>확장 프로그램의 전체 코드는 공개되어 있어 누구나 확인할 수 있습니다:
    <a href="https://github.com/dhkd3213/shorts-blocker">github.com/dhkd3213/shorts-blocker</a></p>

  <h2>문의</h2>
  <p>dhkd3213@gmail.com</p>

  <p class="muted">최종 수정: 2026-05-29</p>
</body>
</html>
```

- [ ] **Step 7.2: Replace `README.md`**

````markdown
# 쇼츠블럭 (Shorts Blocker)

유튜브 쇼츠 시청 시간을 하루 N분으로 제한하고, 홈·사이드바의 쇼츠 진입점을 숨겨주는 Chrome 확장 프로그램입니다.

## 기능

- 하루 쇼츠 시청 시간 제한 (기본 10분, 1~120분 조절 가능)
- 한도 초과 시 차단 페이지로 리다이렉트
- 차단 풀기: 30초 대기 + 2번 확인 (충동 차단용 마찰)
- 홈 쇼츠 shelf · 사이드바 쇼츠 탭 숨김
- Off 모드: 15분 / 1시간 / 무제한 (Off 중에도 사용 시간은 정직하게 카운트)
- 자정 자동 리셋

## 설치 (개발자 모드)

1. 이 레포를 클론
2. Chrome에서 `chrome://extensions` 열기
3. 우측 상단 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드** 클릭
5. `shorts-blocker/` 폴더 선택

## 사용법

- 평소처럼 `youtube.com/shorts` 시청
- 하루 한도(기본 10분)를 다 쓰면 차단 페이지로 이동
- 툴바의 쇼츠블럭 아이콘 클릭 → 팝업에서 한도 조절 / Off 설정
- Off는 차단만 멈춤. 시청 시간은 계속 카운트되어 "오늘 얼마나 봤는지" 확인 가능

## 개인정보

어떤 데이터도 수집·전송하지 않습니다. 모든 설정/사용 시간은 브라우저 로컬에만 저장됩니다.
전체 방침: [docs/privacy.html](docs/privacy.html)

## 개발

```bash
npm test     # src/lib/state.js 단위 테스트
node --check src/background.js   # 문법 체크
```

확장 파일 수정 후 `chrome://extensions`에서 새로고침하세요.

## 라이선스

MIT — [LICENSE](LICENSE)
````

- [ ] **Step 7.3: Commit**

```bash
git add docs/privacy.html README.md
git commit -m "docs: privacy policy page and public README"
```

---

## Verification Summary

After all tasks (and user-supplied icons + manual Chrome checks):

- ✅ `npm test` — all state tests pass (limit + Off + bypass logic)
- ✅ Extension loads with no errors/warnings; toolbar icon present
- ✅ Popup: usage display, working limit slider (persists), Off 15분/1시간/무제한, 다시 켜기
- ✅ ON: Shorts hidden on home + sidebar, counts, blocks at limit
- ✅ OFF: Shorts visible again, still counts, never blocks; timed Off auto-returns to ON
- ✅ Lowering limit below current usage blocks open Shorts tabs immediately
- ✅ Block page: "잠깐만요 ☕" wait card with today usage + 30s bar → "계속하기" → "오늘 이미 …봤는데, 정말 더 보시겠어요?" → bypass
- ✅ v0.1 data preserved after update (todayUsageMs intact, settings created)
- ✅ LICENSE (MIT), `docs/privacy.html`, public README present

**Web Store submission (manual, after this plan):** zip the folder (excluding `docs/`, `tests/`, `node_modules/`, `.git/`), create $5 developer account, enable GitHub Pages for `docs/privacy.html`, capture 5× 1280×800 screenshots, write Korean listing description, submit.
