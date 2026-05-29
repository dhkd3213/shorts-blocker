# 쇼츠블럭 (Shorts Blocker) v0.2 — Design Spec

**Date**: 2026-05-29
**Status**: Approved (brainstorming → ready for implementation plan)
**Builds on**: v0.1 (shipped, working — 8 commits through `17b9ec0`)
**Target**: Chrome Web Store deployment (Korean-first)

---

## 1. Goal

Turn the working-but-hardcoded v0.1 personal tool into a deployable Korean-market Chrome extension. Add user-configurable settings via a popup, a temporary "Off" mechanic that respects user autonomy, a redesigned block-page wait screen that explains itself, and all the assets the Web Store requires.

## 2. Naming

- **Web Store listing name**: `쇼츠블럭 (Shorts Blocker)` — Korean primary, English in parens for dual-search
- **Manifest `name`**: `쇼츠블럭`
- **Manifest `description`**: `유튜브 쇼츠 시청 시간을 하루 N분으로 제한하고, 홈·사이드바의 쇼츠 진입점을 숨겨주는 확장 프로그램입니다.`
- UI language: **Korean only** for v0.2. English/`_locales/` i18n deferred to v0.3.

## 3. Scope

### In scope (v0.2)

| Capability | Notes |
|---|---|
| Popup UI | Status badge, today-usage + progress, daily-limit slider, Off toggle |
| Configurable daily limit | 1–120 min slider, default 10 min, persisted in `settings` |
| "Off" mechanic | 15 min / 1 hour / unlimited; counting continues; auto-on for timed modes |
| Redesigned block-page wait screen | "잠깐만요 ☕" card with reason + today usage + progress bar |
| Dynamic UI suppression | Shorts UI hidden only while ON, re-shown while OFF |
| v0.1 → v0.2 migration | Existing usage data preserved, `settings` key created with defaults |
| Icons | 16/48/128 PNG (user-provided) |
| Privacy policy | `docs/privacy.html` hosted via GitHub Pages |
| Web Store assets | 1280×800 screenshots (user-captured), Korean description |
| MIT license + public repo | github.com/dhkd3213/shorts-blocker |

### Out of scope (deferred to v0.3+)

- Options page (popup is sufficient)
- i18n / `_locales/` (Korean only for now)
- Custom block-page message (user-editable reminder)
- Usage statistics / history charts / weekly graph
- Escalating bypass friction (dropped — repeated same-day bypass is rare)
- Channel whitelist
- Other platforms (Reels, TikTok)
- Showing Shorts UI again during Off (kept hidden in v0.2)

## 4. Data Model

`chrome.storage.local` — two top-level keys:

```js
{
  // EXISTING (v0.1) — transient, resets daily
  state: {
    todayUsageMs: number,        // 0..n (keeps counting even past limit, even during Off)
    todayDateKey: string,        // "2026-05-29" local date
    bypassUntil: number | null   // block-page bypass window (10 min, set after 30s+2× confirm)
  },

  // NEW (v0.2) — persistent preferences, survive daily reset
  settings: {
    dailyLimitMs: number,                    // default 600_000 (10 min); slider range 60_000..7_200_000
    offUntil: number | "infinite" | null     // null = ON; number = timed-off epoch ms; "infinite" = manual off
  }
}
```

`chrome.alarms`:
- `daily-reset` — existing, fires at local midnight, repeats every 1440 min
- `off-expire` — **new**, one-shot, fires at `settings.offUntil` for timed-off modes; clears `offUntil` to `null`

### Two distinct "pause" concepts — do not conflate

| | `bypassUntil` | `offUntil` |
|---|---|---|
| Triggered from | Block page (30s wait + 2× confirm) | Popup Off button |
| Counting | **paused** (don't count) | **continues** (honest tracking) |
| Blocking | suppressed | suppressed |
| UI hiding | unchanged (stays hidden) | **removed** (Shorts visible again) |
| Duration | 10 min fixed | 15 min / 1 hr / unlimited |

## 5. ON / OFF Semantics (canonical)

The user's mental model: ON = the tool is doing its job; OFF = the tool steps aside (but still keeps an honest count).

| Behavior | ON | OFF (any mode) |
|---|---|---|
| Count `todayUsageMs` | ✅ | ✅ (for awareness/stats) |
| Redirect to block page at limit | ✅ | ❌ |
| Hide home Shorts shelf | ✅ | ❌ (shelf visible) |
| Hide sidebar Shorts entry | ✅ | ❌ (entry visible) |

When OFF ends (timer expires or user taps "다시 켜기"): if `todayUsageMs >= dailyLimitMs`, the next tick blocks immediately. Time watched during Off counts against the day.

## 6. Pure State Logic (`src/lib/state.js`) Changes

`applyTick` gains a `settings` parameter and reads the limit + off-state from it instead of the hardcoded constant.

```js
export const DEFAULT_DAILY_LIMIT_MS = 10 * 60 * 1000;
export const BYPASS_DURATION_MS = 10 * 60 * 1000;
export const OFF_DURATIONS = { '15min': 15*60*1000, '1hour': 60*60*1000 }; // 'infinite' handled separately

export function isOffActive(settings, now) {
  const off = settings?.offUntil;
  if (off == null) return false;
  if (off === 'infinite') return true;
  return now.getTime() < off;
}

// signature CHANGED: now takes settings
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
  // OFF: count continues, but never block
  const next = { ...working, todayUsageMs: working.todayUsageMs + tickMs };
  if (isOffActive(settings, now)) {
    return { state: next, blocked: false };
  }
  const limit = settings?.dailyLimitMs ?? DEFAULT_DAILY_LIMIT_MS;
  const blocked = next.todayUsageMs >= limit;
  return { state: next, blocked };
}

export function applyOff(settings, mode, now) {
  // mode: '15min' | '1hour' | 'infinite'
  if (mode === 'infinite') return { ...settings, offUntil: 'infinite' };
  return { ...settings, offUntil: now.getTime() + OFF_DURATIONS[mode] };
}

export function turnOn(settings) {
  return { ...settings, offUntil: null };
}

export function setLimit(settings, limitMs) {
  return { ...settings, dailyLimitMs: limitMs };
}

export function defaultSettings() {
  return { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null };
}
```

`todayKey`, `startBypass`, `resetDay` unchanged. `DAILY_LIMIT_MS` constant renamed to `DEFAULT_DAILY_LIMIT_MS` (used only as fallback).

**Test impact**: existing `applyTick` tests get a `settings` argument threaded through. New tests for `isOffActive`, `applyOff`, `turnOn`, `setLimit`, and the "counts-but-doesn't-block-during-off" behavior.

## 7. Service Worker (`src/background.js`) Changes

New responsibilities:

1. **Migration** — `migrateIfNeeded()` runs on `onInstalled` + `onStartup`:
   ```js
   async function migrateIfNeeded() {
     const stored = await chrome.storage.local.get('settings');
     if (!stored.settings) {
       await chrome.storage.local.set({ settings: defaultSettings() });
     }
   }
   ```

2. **`tick` handler** now loads `settings` too and passes to `applyTick`. Still serialized through the existing `serialize()` promise queue.

3. **New message handlers** (all serialized):
   | Message | Effect |
   |---|---|
   | `getStatus` | returns `{ ...state, ...settings, now: Date.now() }` for popup + block page |
   | `setLimit { limitMs }` | `settings = setLimit(settings, limitMs)`; save |
   | `setOff { mode }` | `settings = applyOff(settings, mode, new Date())`; save; if timed, schedule `off-expire` alarm |
   | `turnOn` | `settings = turnOn(settings)`; save; clear `off-expire` alarm |

4. **`off-expire` alarm handler** — clears `offUntil` to null and saves (storage change propagates to content scripts).

5. **Limit-change re-evaluation**: after `setLimit`, if new limit is below current usage and not off, broadcast block to open Shorts tabs (so lowering the limit takes effect without waiting for the next tick). Conversely raising the limit doesn't force-unblock (user navigates manually).

All chrome API usage stays within existing permissions (`storage`, `alarms`, `tabs`). No new permissions.

## 8. Content Script (`src/content.js`) Changes

Add dynamic UI-suppression toggling. The CSS is rewritten with a negation selector so the default (no class) state hides Shorts — preserving v0.1 behavior and avoiding a flash for the common ON case.

```js
async function syncOffClass() {
  const { settings } = await chrome.storage.local.get('settings');
  const off = settings && isOffActiveLocal(settings, Date.now());
  document.documentElement.classList.toggle('shorts-blocker-off', !!off);
}
// isOffActiveLocal: small inline copy of isOffActive (content scripts can't import the module)

syncOffClass();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncOffClass();
});
```

Tick sending + `block` listener (redirect to `blocked.html`) unchanged from v0.1.

> Note: content scripts under this manifest config can't use ES `import`, so `isOffActive` logic is duplicated as a tiny inline helper. Acceptable — it's 3 lines. Keep in sync with `state.js`.

## 9. Content CSS (`src/content.css`) Changes

Wrap every existing selector with `html:not(.shorts-blocker-off)`:

```css
html:not(.shorts-blocker-off) ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) { display: none !important; }
html:not(.shorts-blocker-off) ytd-reel-shelf-renderer { display: none !important; }
html:not(.shorts-blocker-off) ytd-guide-entry-renderer a[title="Shorts"],
html:not(.shorts-blocker-off) ytd-guide-entry-renderer a[title="쇼츠"] { display: none !important; }
html:not(.shorts-blocker-off) ytd-mini-guide-entry-renderer[aria-label="Shorts"],
html:not(.shorts-blocker-off) ytd-mini-guide-entry-renderer[aria-label="쇼츠"] { display: none !important; }
```

Default (no class) → hidden (ON behavior, v0.1-compatible). `.shorts-blocker-off` present → selectors don't match → Shorts visible.

## 10. Popup (`src/popup.html` / `popup.css` / `popup.js`) — NEW

Size ~320×400. Color scheme matches block page (`#161616` bg, `#232323` card, `#ff4d4d` accent).

### Layout (ON state)

```
┌─────────────────────────────────┐
│  쇼츠블럭                ✓ ON   │  ← status badge
├─────────────────────────────────┤
│  오늘 사용                       │
│  3분 24초 / 10분                 │
│  ▓▓▓▓░░░░░░░░░░░░░  34%          │  ← progress bar
├─────────────────────────────────┤
│  하루 한도                       │
│  ◯━━━━━━━━━━━━━━ 10분           │  ← slider 1–120 min
├─────────────────────────────────┤
│  [   Off  ▾   ]                 │  ← dropdown → 15분 / 1시간 / 무제한
└─────────────────────────────────┘
```

### Layout (OFF state)

```
┌─────────────────────────────────┐
│  쇼츠블럭          OFF · 35분    │  (or "OFF" for infinite)
├─────────────────────────────────┤
│  오늘 사용 (Off 중에도 카운트)    │
│  47분 12초 / 10분 ⚠              │  ← over limit, still counting
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 470%        │
├─────────────────────────────────┤
│  하루 한도  ◯━━━ 10분            │
├─────────────────────────────────┤
│  [   ▶  다시 켜기   ]           │
└─────────────────────────────────┘
```

### Behavior

- On open: send `getStatus`, render usage / limit / state.
- Slider: `input` event updates the label live; `change` (release) — or debounced 200ms — sends `setLimit { limitMs }`.
- Off dropdown: selecting 15분/1시간 → `setOff { mode: '15min'|'1hour' }`; 무제한 → `setOff { mode: 'infinite' }`. Popup re-renders to OFF layout.
- "다시 켜기" → `turnOn`. Re-renders to ON layout.
- Progress bar caps visual fill at 100% but label shows real percentage (can exceed 100%).
- Timed-off remaining time: popup computes from `offUntil - now` and shows in badge; refreshes every 30s while open.

## 11. Block Page Redesign (`src/blocked.html` / `blocked.css` / `blocked.js`)

The big UX upgrade: the 30-second wait now explains itself and shows today's usage.

### Initial block screen (limit reached)

Unchanged from v0.1 in spirit — motivational card, midnight countdown, "YouTube 홈으로" + "10분만 더 보기" buttons.

### Wait screen (after "10분만 더 보기" tapped)

Replaces the old button-only countdown with a full card:

```
┌─────────────────────────────────┐
│  잠깐만요 ☕                     │
│                                 │
│  보통 30초만 지나면              │
│  '꼭 봐야지' 느낌이 사라져요      │
│  ─────────────────────────       │
│  오늘 시청 시간                  │
│  12분 32초                       │
│  ▓▓▓▓▓▓▓▓▓▓░░░ (한도 10분)      │  ← today usage vs limit
│  ─────────────────────────       │
│           24초                  │  ← shrinking countdown number
│       ━━━━━━━░░░░               │  ← countdown progress bar
└─────────────────────────────────┘
```

- Today's usage + limit fetched via `getStatus` on page load (block page is an extension page → `chrome.runtime.sendMessage` works).
- 30-second countdown with a progress bar (fills/empties over 30s).
- No escalating friction.

### After countdown — two confirms

```
confirm 1: "오늘 이미 12분 32초 봤는데, 정말 더 보시겠어요?"
confirm 2: "후회 안 할 자신 있어요?"
→ both OK → sendMessage('bypass') → location.href = 'https://www.youtube.com/shorts'
```

The first confirm interpolates the live today-usage string. The bypass mechanic (`bypassUntil = now + 10min`) is unchanged in `background.js`.

## 12. Manifest (`manifest.json`) Changes

```json
{
  "manifest_version": 3,
  "name": "쇼츠블럭",
  "version": "0.2.0",
  "description": "유튜브 쇼츠 시청 시간을 하루 N분으로 제한하고, 홈·사이드바의 쇼츠 진입점을 숨겨주는 확장 프로그램입니다.",
  "permissions": ["storage", "alarms", "tabs"],
  "host_permissions": ["*://*.youtube.com/*"],
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },
  "action": {
    "default_popup": "src/popup.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png" },
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

## 13. Deployment Artifacts

- **Icons** (`icons/16.png`, `48.png`, `128.png`) — user-provided. **DECISION: keep current "cracked Shorts logo" icons and accept trademark-rejection risk** (user choice C, 2026-05-29). The cracked-glass twist signals "breaking the Shorts habit." If Web Store rejects the listing for trademark reasons, swap to an original design then. User must save the three PNGs into `icons/` before loading the v0.2 build.
- **Privacy policy** (`docs/privacy.html`) — short page: no data collected, all storage local, no transmission/ads/tracking, code public. Hosted at `https://dhkd3213.github.io/shorts-blocker/privacy.html` via GitHub Pages. Contact: dhkd3213@gmail.com (or GitHub Issues).
- **Screenshots** — 1280×800 PNG ×5, captured from the running extension (popup, block page, before/after home, Off menu, wait screen). User-captured after code is complete.
- **LICENSE** — MIT.
- **README** — rewritten for public: what it does, install, configure, privacy stance, repo link.

## 14. File Structure (v0.2 delta)

```
shorts-blocker/
├── manifest.json            (modified)
├── LICENSE                  (NEW — MIT)
├── README.md                (modified)
├── icons/                   (NEW)
│   ├── 16.png  48.png  128.png   (user-provided)
├── src/
│   ├── popup.html           (NEW)
│   ├── popup.css            (NEW)
│   ├── popup.js             (NEW)
│   ├── background.js        (modified — migration, 4 new handlers, off-expire alarm)
│   ├── content.js           (modified — syncOffClass)
│   ├── content.css          (modified — negation selectors)
│   ├── lib/state.js         (modified — settings-aware applyTick + helpers)
│   ├── blocked.html         (modified — wait-screen card markup)
│   ├── blocked.css          (modified — wait-screen styles)
│   └── blocked.js           (modified — getStatus, rich wait screen, data confirm)
├── docs/
│   ├── privacy.html         (NEW)
│   └── superpowers/...      (specs + plans)
└── tests/state.test.js      (modified — settings threaded, new helper tests)
```

## 15. Technical Decisions

- **`settings` separate from `state`** — preferences persist; transient day-state resets. Clean migration: v0.1 users keep their `state`, gain `settings`.
- **`offUntil` encodes three states in one field** (`null` / number / `"infinite"`) — avoids a parallel `offMode` field. JSON-safe (no `Infinity`).
- **Negation CSS selector** (`html:not(.shorts-blocker-off)`) — default hides (ON, v0.1-compatible), avoids FOUC for the common case; only Off users see a brief flash.
- **Inline `isOffActive` duplicate in content.js** — content scripts can't import the ES module; 3-line copy is cheaper than bundling.
- **No new permissions** — popup (`action`) needs none; everything reuses storage/alarms/tabs.
- **Korean-only** — fastest path to a Korean-market launch; i18n is mechanical and deferred.

## 16. Open Questions (resolve during implementation)

1. Slider granularity & snap points — continuous 1-min, or snap to 5/10/15/30/60? (lean: 1-min continuous with a readable label)
2. ~~Exact final icon (trademark decision above)~~ — RESOLVED: keep cracked-Shorts icons, accept risk (choice C)
3. Whether lowering the limit should instantly block open tabs or wait for next tick (spec says instant via broadcast; confirm during impl)
