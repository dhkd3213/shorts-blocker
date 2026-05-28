# Shorts Blocker v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that caps YouTube Shorts viewing at 10 minutes per day and hides Shorts entry points on home + sidebar.

**Architecture:** Service worker is the source of truth for `todayUsageMs` + `bypassUntil` in `chrome.storage.local`. Content script ticks once per second while a Shorts tab is visible. Pure state-transition logic lives in `src/lib/state.js` so it can be unit-tested with `node:test` outside the browser. A `chrome-extension://blocked.html` page handles the block UX + 30s + 2× confirm bypass flow.

**Tech Stack:** Chrome Manifest V3 · vanilla ES modules (no bundler) · `node:test` for unit tests · no runtime dependencies.

---

## File Structure

Created in `shorts-blocker/`:

| Path | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest — permissions, entry points |
| `package.json` | Dev-only, for `npm test` (no runtime deps) |
| `src/lib/state.js` | Pure state transitions (`applyTick`, `startBypass`, `resetDay`, `todayKey`). Imported by background.js and tests. |
| `src/background.js` | Service worker. Wires `state.js` to `chrome.storage`, `chrome.alarms`, `chrome.runtime` messaging, `chrome.tabs`. |
| `src/content.js` | Content script. Sends `tick` while `/shorts/*` is visible. Listens for `block` → redirects. |
| `src/content.css` | CSS that hides home Shorts shelf + sidebar Shorts entry. |
| `src/blocked.html` | Block-page markup. |
| `src/blocked.css` | Block-page styles. |
| `src/blocked.js` | Block-page logic — midnight countdown + 30s bypass + 2× confirm. |
| `tests/state.test.js` | Unit tests for `state.js`. |
| `README.md` | Install instructions for dev mode. |

Why this split:
- `state.js` is pure → testable without Chrome → TDD lives here.
- `background.js`, `content.js`, `blocked.js` are thin glue around Chrome APIs → manual verification.
- Splitting state from chrome-API plumbing keeps each file small and one-purpose.

No `icons/` directory in v0.1 — manifest omits the `icons` key so Chrome doesn't warn. Icons added in v0.2 for Web Store submission.

---

## Task 1: Project skeleton + manifest + load in Chrome

**Files:**
- Create: `shorts-blocker/manifest.json`
- Create: `shorts-blocker/src/background.js` (stub)
- Create: `shorts-blocker/src/content.js` (stub)
- Create: `shorts-blocker/src/content.css` (empty)
- Create: `shorts-blocker/.gitignore`

(Git is already initialized in `shorts-blocker/`; the planning docs are the first commit.)

- [ ] **Step 1.1: Write `.gitignore`**

```
node_modules/
.DS_Store
*.log
```

- [ ] **Step 1.2: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Shorts Blocker",
  "version": "0.1.0",
  "description": "Limit YouTube Shorts to 10 minutes a day and hide entry points.",
  "permissions": ["storage", "alarms", "tabs"],
  "host_permissions": ["*://*.youtube.com/*"],
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["src/content.js"],
      "css": ["src/content.css"],
      "run_at": "document_start"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/blocked.html", "src/blocked.js", "src/blocked.css"],
      "matches": ["*://*.youtube.com/*"]
    }
  ]
}
```

- [ ] **Step 1.3: Write stub `src/background.js`**

```js
console.log('[shorts-blocker] background loaded');
```

- [ ] **Step 1.4: Write stub `src/content.js`**

```js
console.log('[shorts-blocker] content loaded on', location.href);
```

- [ ] **Step 1.5: Write empty `src/content.css`**

```css
/* CSS rules added in Task 5 */
```

- [ ] **Step 1.6: Manual verify in Chrome**

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**, select the `shorts-blocker/` folder
4. Confirm the extension appears with no errors (errors show as a red "Errors" button)
5. Click **Service worker** under the extension card → DevTools opens → console should show `[shorts-blocker] background loaded`
6. Navigate to `https://www.youtube.com/` → open DevTools console → should see `[shorts-blocker] content loaded on https://www.youtube.com/`

Expected: both log lines visible. If not, check manifest syntax with `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`.

- [ ] **Step 1.7: Commit**

```bash
git add manifest.json src/ .gitignore
git commit -m "feat: project skeleton with MV3 manifest and stub scripts"
```

---

## Task 2: Pure state library + unit tests (TDD)

**Files:**
- Create: `shorts-blocker/package.json`
- Create: `shorts-blocker/src/lib/state.js`
- Create: `shorts-blocker/tests/state.test.js`

- [ ] **Step 2.1: Write `package.json`** (dev-only, no runtime deps)

```json
{
  "name": "shorts-blocker",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2.2: Write the failing test file `tests/state.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey,
  applyTick,
  startBypass,
  resetDay,
  DAILY_LIMIT_MS,
  BYPASS_DURATION_MS,
} from '../src/lib/state.js';

test('todayKey formats local date as YYYY-MM-DD', () => {
  const d = new Date(2026, 4, 29); // May 29 (month index 4)
  assert.equal(todayKey(d), '2026-05-29');
});

test('todayKey pads single-digit month and day', () => {
  const d = new Date(2026, 0, 3); // Jan 3
  assert.equal(todayKey(d), '2026-01-03');
});

test('applyTick increments todayUsageMs by tickMs', () => {
  const state = { todayUsageMs: 0, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('applyTick reports blocked once limit hit', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS - 1000, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS);
  assert.equal(blocked, true);
});

test('applyTick does not increment while bypass is active', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: now.getTime() + 60000,
  };
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS);
  assert.equal(blocked, false);
});

test('applyTick resumes counting once bypass expires', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: now.getTime() - 1000, // already expired
  };
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS + 1000);
  assert.equal(blocked, true);
});

test('applyTick safety-net resets when stored date is stale', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS, todayDateKey: '2026-05-28', bypassUntil: null };
  const now = new Date(2026, 4, 29, 0, 0, 5);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayDateKey, '2026-05-29');
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('startBypass sets bypassUntil = now + BYPASS_DURATION_MS', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const next = startBypass(state, now);
  assert.equal(next.bypassUntil, now.getTime() + BYPASS_DURATION_MS);
});

test('resetDay zeros usage, clears bypass, updates date', () => {
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: 1234567890,
  };
  const now = new Date(2026, 4, 30);
  const next = resetDay(state, now);
  assert.equal(next.todayUsageMs, 0);
  assert.equal(next.todayDateKey, '2026-05-30');
  assert.equal(next.bypassUntil, null);
});
```

- [ ] **Step 2.3: Run tests to verify they fail**

```bash
cd shorts-blocker
npm test
```

Expected: `Cannot find module '../src/lib/state.js'` (or all tests fail).

- [ ] **Step 2.4: Write minimal implementation `src/lib/state.js`**

```js
export const DAILY_LIMIT_MS = 10 * 60 * 1000;       // 10 minutes
export const BYPASS_DURATION_MS = 10 * 60 * 1000;   // 10 minutes

export function todayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function applyTick(state, now, tickMs) {
  let working = state;
  const key = todayKey(now);
  if (working.todayDateKey !== key) {
    working = { ...working, todayUsageMs: 0, todayDateKey: key };
  }
  if (working.bypassUntil && now.getTime() < working.bypassUntil) {
    return { state: working, blocked: false };
  }
  const next = { ...working, todayUsageMs: working.todayUsageMs + tickMs };
  const blocked = next.todayUsageMs >= DAILY_LIMIT_MS;
  return { state: next, blocked };
}

export function startBypass(state, now) {
  return { ...state, bypassUntil: now.getTime() + BYPASS_DURATION_MS };
}

export function resetDay(state, now) {
  return {
    ...state,
    todayUsageMs: 0,
    todayDateKey: todayKey(now),
    bypassUntil: null,
  };
}
```

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
npm test
```

Expected: all 9 tests pass, exit code 0.

- [ ] **Step 2.6: Commit**

```bash
git add package.json src/lib/state.js tests/state.test.js
git commit -m "feat: pure state transitions with unit tests"
```

---

## Task 3: Service worker — wire state to Chrome APIs

**Files:**
- Modify: `shorts-blocker/src/background.js` (full rewrite)

- [ ] **Step 3.1: Write `src/background.js`**

```js
import {
  applyTick,
  startBypass,
  resetDay,
  todayKey,
} from './lib/state.js';

const STORAGE_KEY = 'state';
const SHORTS_URL_MATCH = '*://*.youtube.com/shorts/*';
const ALARM_NAME = 'daily-reset';

function defaultState() {
  return {
    todayUsageMs: 0,
    todayDateKey: todayKey(new Date()),
    bypassUntil: null,
  };
}

async function loadState() {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  return obj[STORAGE_KEY] ?? defaultState();
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
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
  nextMidnight.setHours(24, 0, 0, 0);
  chrome.alarms.create(ALARM_NAME, {
    when: nextMidnight.getTime(),
    periodInMinutes: 1440,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleMidnightAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleMidnightAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const state = await loadState();
  await saveState(resetDay(state, new Date()));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'tick') {
        const state = await loadState();
        const { state: next, blocked } = applyTick(state, new Date(), 1000);
        await saveState(next);
        if (blocked) await broadcastBlock();
        sendResponse({ ok: true, todayUsageMs: next.todayUsageMs, blocked });
      } else if (msg?.type === 'bypass') {
        const state = await loadState();
        await saveState(startBypass(state, new Date()));
        sendResponse({ ok: true });
      } else if (msg?.type === 'getState') {
        const state = await loadState();
        sendResponse(state);
      } else {
        sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async sendResponse
});
```

- [ ] **Step 3.2: Reload the extension in Chrome**

1. Open `chrome://extensions`
2. Click the reload icon on the Shorts Blocker card
3. Click **Service worker** to open its DevTools
4. Console: no errors. If you see "import" syntax errors, double-check `"type": "module"` is in `manifest.json` background section.

- [ ] **Step 3.3: Manual verify messaging works**

In the service worker DevTools console:

```js
await chrome.runtime.sendMessage({ type: 'getState' })
```

Expected: returns an object like `{ todayUsageMs: 0, todayDateKey: "2026-05-29", bypassUntil: null }`.

```js
await chrome.runtime.sendMessage({ type: 'tick' })
```

Expected: `{ ok: true, todayUsageMs: 1000, blocked: false }`.

Repeat a few times — `todayUsageMs` increments by 1000 each call.

- [ ] **Step 3.4: Manual verify alarm scheduled**

In the service worker DevTools console:

```js
await chrome.alarms.getAll()
```

Expected: one alarm named `daily-reset` with `scheduledTime` close to next local midnight.

- [ ] **Step 3.5: Commit**

```bash
git add src/background.js
git commit -m "feat: service worker for tick accumulation and daily alarm"
```

---

## Task 4: Content script — tick sender + block listener

**Files:**
- Modify: `shorts-blocker/src/content.js` (full rewrite)

- [ ] **Step 4.1: Write `src/content.js`**

```js
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
```

- [ ] **Step 4.2: Reload extension and reset state**

1. `chrome://extensions` → reload Shorts Blocker
2. In service worker DevTools console:

```js
await chrome.storage.local.clear()
```

(Wipes state — Task 3's manual tests accumulated some ms. Next tick will lazy-create fresh state with today's local date.)

- [ ] **Step 4.3: Manual verify ticks accumulate on Shorts**

1. Open `https://www.youtube.com/shorts/` in a new tab
2. Wait ~10 seconds
3. In the service worker DevTools console:

```js
(await chrome.storage.local.get('state')).state.todayUsageMs
```

Expected: roughly 10000 (± a couple seconds because of the first interval delay).

- [ ] **Step 4.4: Manual verify ticks stop when tab hidden**

1. With the Shorts tab still open, switch to another tab for ~10 seconds
2. Check `todayUsageMs` again — should not have grown.
3. Switch back to the Shorts tab — should start growing again.

- [ ] **Step 4.5: Commit**

```bash
git add src/content.js
git commit -m "feat: content script ticks while Shorts is visible, listens for block"
```

---

## Task 5: CSS-only UI suppression

**Files:**
- Modify: `shorts-blocker/src/content.css` (replace contents)

- [ ] **Step 5.1: Write `src/content.css`**

```css
/* Home page Shorts shelves (two variants YouTube uses) */
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) {
  display: none !important;
}
ytd-reel-shelf-renderer {
  display: none !important;
}

/* Left sidebar Shorts entry — full guide */
ytd-guide-entry-renderer a[title="Shorts"],
ytd-guide-entry-renderer a[title="쇼츠"] {
  display: none !important;
}

/* Left sidebar Shorts entry — mini (collapsed) guide */
ytd-mini-guide-entry-renderer[aria-label="Shorts"],
ytd-mini-guide-entry-renderer[aria-label="쇼츠"] {
  display: none !important;
}
```

- [ ] **Step 5.2: Reload extension**

`chrome://extensions` → reload Shorts Blocker.

- [ ] **Step 5.3: Manual verify home shelf hidden**

1. Open `https://www.youtube.com/`
2. Scroll the home feed — there should be no "Shorts" horizontal shelf row.
3. If you still see one, right-click it → Inspect → check which custom element wraps it. Add a selector to `content.css` and repeat. Common candidates: `ytd-rich-shelf-renderer`, `grid-shelf-view-model`.

- [ ] **Step 5.4: Manual verify sidebar tab hidden**

1. With `https://www.youtube.com/` open, check the left sidebar — no "Shorts" entry between Home and Subscriptions.
2. Collapse the sidebar (hamburger icon) — mini sidebar should also not show the Shorts icon.
3. If you still see it, inspect the element and add the matching selector.

- [ ] **Step 5.5: Confirm search results unaffected**

1. Search for something on YouTube
2. Shorts mixed into search results should still appear (per Q5 = option A — search is intentionally not filtered).

- [ ] **Step 5.6: Commit**

```bash
git add src/content.css
git commit -m "feat: CSS rules to hide home Shorts shelf and sidebar Shorts entry"
```

---

## Task 6: Block page (HTML + CSS)

**Files:**
- Create: `shorts-blocker/src/blocked.html`
- Create: `shorts-blocker/src/blocked.css`

- [ ] **Step 6.1: Write `src/blocked.html`**

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
  <main class="card">
    <h1 class="title">쇼츠는 그만 🛑</h1>
    <p class="sub">오늘 10분 한도를 다 썼어요.</p>
    <p class="countdown">
      자정까지 <span id="time-left">계산 중…</span> 남음
    </p>
    <div class="actions">
      <a href="https://www.youtube.com" class="btn primary">YouTube 홈으로</a>
      <button id="bypass-btn" class="btn secondary" type="button">
        10분만 더 보기
      </button>
    </div>
  </main>
  <script src="blocked.js"></script>
</body>
</html>
```

- [ ] **Step 6.2: Write `src/blocked.css`**

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

.title {
  font-size: 28px;
  margin-bottom: 16px;
}

.sub {
  font-size: 16px;
  color: #c0c0c0;
  margin-bottom: 24px;
}

.countdown {
  font-size: 14px;
  color: #909090;
  margin-bottom: 32px;
}

#time-left {
  color: #f0f0f0;
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: opacity 0.15s ease;
}

.btn:hover { opacity: 0.85; }

.btn.primary {
  background: #ff4d4d;
  color: white;
}

.btn.secondary {
  background: #3a3a3a;
  color: #d0d0d0;
}

.btn:disabled {
  background: #2a2a2a;
  color: #666;
  cursor: not-allowed;
  opacity: 1;
}
```

- [ ] **Step 6.3: Manual verify the page renders**

1. Open `chrome://extensions` → copy the extension's ID from the Shorts Blocker card
2. In a new tab, open `chrome-extension://<extension-id>/src/blocked.html`
3. Expected: dark card centered on screen, title "쇼츠는 그만 🛑", two buttons, "계산 중…" placeholder where countdown will go.

- [ ] **Step 6.4: Commit**

```bash
git add src/blocked.html src/blocked.css
git commit -m "feat: block page markup and styles"
```

---

## Task 7: Block page logic — countdown + bypass flow

**Files:**
- Create: `shorts-blocker/src/blocked.js`

- [ ] **Step 7.1: Write `src/blocked.js`**

```js
const BYPASS_COUNTDOWN_S = 30;

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

updateMidnightCountdown();
setInterval(updateMidnightCountdown, 30000);

const bypassBtn = document.getElementById('bypass-btn');

function startCountdown() {
  bypassBtn.disabled = true;
  let remaining = BYPASS_COUNTDOWN_S;
  bypassBtn.textContent = `잠시만요… ${remaining}`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      bypassBtn.textContent = `잠시만요… ${remaining}`;
    } else {
      clearInterval(interval);
      bypassBtn.disabled = false;
      bypassBtn.textContent = '정말 보시겠어요?';
      bypassBtn.onclick = confirmBypass;
    }
  }, 1000);
}

async function confirmBypass() {
  if (!confirm('정말 더 보고 싶어요?')) return;
  if (!confirm('후회 안 할 자신 있어요?')) return;
  const res = await chrome.runtime.sendMessage({ type: 'bypass' });
  if (res?.ok) {
    location.href = 'https://www.youtube.com/shorts';
  } else {
    alert('우회 실패: ' + (res?.error ?? 'unknown'));
  }
}

bypassBtn.onclick = startCountdown;
```

- [ ] **Step 7.2: Manual verify countdown displays**

1. Reload the extension
2. Open `chrome-extension://<extension-id>/src/blocked.html`
3. Within ~30s the "자정까지 …" line should show a real value like "8시간 42분".

- [ ] **Step 7.3: Manual verify 30s countdown gate**

1. On the block page, click "10분만 더 보기"
2. Button should change to "잠시만요… 30" and become disabled
3. Number should tick down once per second
4. At 0, button re-enables with text "정말 보시겠어요?"

- [ ] **Step 7.4: Manual verify 2× confirm + bypass**

1. After countdown, click the button
2. First `confirm()` dialog: "정말 더 보고 싶어요?" — click OK
3. Second `confirm()` dialog: "후회 안 할 자신 있어요?" — click OK
4. Page redirects to `https://www.youtube.com/shorts`
5. In service worker DevTools:

```js
(await chrome.storage.local.get('state')).state.bypassUntil
```

Expected: a future timestamp roughly 10 minutes from now.

- [ ] **Step 7.5: Commit**

```bash
git add src/blocked.js
git commit -m "feat: block page midnight countdown and gated 2x confirm bypass"
```

---

## Task 8: End-to-end smoke test + README

**Files:**
- Create: `shorts-blocker/README.md`

- [ ] **Step 8.1: Write `README.md`**

````markdown
# Shorts Blocker

Limit YouTube Shorts to 10 minutes per day. Hides home Shorts shelf and sidebar Shorts entry.

## Install (dev mode)

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Toggle **Developer mode** (top-right) on
4. Click **Load unpacked**
5. Select the `shorts-blocker/` folder

## Usage

- Visit `youtube.com/shorts` like normal
- After 10 minutes of visible watch time today, you're redirected to a block page
- Click "10분만 더 보기" → 30s wait → 2× confirm → 10-minute bypass
- Counter resets at local midnight automatically

## Configure

In v0.1 the limit is hardcoded to 10 minutes. To change it, edit `DAILY_LIMIT_MS` in `src/lib/state.js`.

## Reset counter manually

Open the extension's service worker DevTools (`chrome://extensions` → **Service worker** link), then:

```js
await chrome.storage.local.clear()
```

## Develop

```bash
npm test     # run unit tests for src/lib/state.js
```

After editing extension files, reload the extension from `chrome://extensions`.
````

- [ ] **Step 8.2: End-to-end smoke test**

Run through the full flow once. In service worker DevTools, set the counter close to the limit so this doesn't take 10 real minutes:

```js
// toLocaleDateString('sv') returns local-date "YYYY-MM-DD"
await chrome.storage.local.set({ state: { todayUsageMs: 595000, todayDateKey: new Date().toLocaleDateString('sv'), bypassUntil: null } })
```

Then:

1. Open `https://www.youtube.com/shorts/` — watch for ~5 seconds
2. Expected: tab redirects to the block page
3. Block page shows midnight countdown
4. Click "10분만 더 보기" → wait 30s → confirm twice
5. Tab navigates to `youtube.com/shorts` — you can watch Shorts again
6. In service worker DevTools, check state — `bypassUntil` should be ~10 min in the future
7. Bonus: wait 10 minutes (or set `bypassUntil` to a past timestamp manually) and watch a Shorts page → should re-block within 1-2 seconds

Document any bugs found and fix before committing.

- [ ] **Step 8.3: Verify home + sidebar still clean**

1. Open `https://www.youtube.com/` — no Shorts shelf in home feed
2. Sidebar (expanded and collapsed) — no Shorts entry

- [ ] **Step 8.4: Commit**

```bash
git add README.md
git commit -m "docs: README with install instructions and dev notes"
```

---

## Verification Summary

After all tasks complete, you should have:

- ✅ All 9 unit tests passing (`npm test`)
- ✅ Extension loads in Chrome with no errors or warnings
- ✅ Shorts shelf hidden on home, Shorts entry hidden in sidebar
- ✅ Search results still show Shorts (intentional)
- ✅ Visible viewing time on `/shorts/` accumulates at 1 sec/sec
- ✅ Hidden tab does not accumulate
- ✅ Hitting 10 min redirects all Shorts tabs to block page
- ✅ Block page shows midnight countdown
- ✅ Bypass requires 30s wait + 2 confirms, grants 10 min then re-blocks
- ✅ Daily-reset alarm scheduled for next midnight

That's the v0.1 personal MVP — works for the user from day one. v0.2 (Web Store) work begins later: popup UI, options page, i18n, icons, screenshots, privacy policy.
