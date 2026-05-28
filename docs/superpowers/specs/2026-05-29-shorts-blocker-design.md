# Shorts Blocker — Design Spec

**Date**: 2026-05-29
**Status**: Approved (brainstorming → ready for implementation plan)
**Target**: Personal MVP first (v0.1), then Chrome Web Store deployment (v0.2)

---

## 1. Problem

User loses hours to YouTube Shorts when intending to work. Existing extensions solve only part of the problem:

- **Unhook** hides Shorts UI but has no time limit
- **LeechBlock NG** has time limits but doesn't hide the Shorts UI surface that triggers entry
- No single extension combines both with the willpower-resistant block flow this user needs

This extension combines UI suppression (reduce temptation) + hard time limit (catch the breach) + soft-strict bypass (30s + 2x confirm) in one tool.

## 2. Goals & Non-Goals

### Goals

- Hide Shorts entry points so user rarely sees them by accident
- Hard-cap Shorts viewing at **10 minutes per day** based on actual visible watch time
- Reset daily at midnight (local time)
- When limit reached, redirect to a block page with motivational message + countdown to reset
- Allow temporary bypass only through enough friction to break impulse (30s countdown + 2x confirmation)
- Ship a working personal v0.1 in 1-2 days; expand to public v0.2 in another 1-2 days

### Non-Goals (v0.1)

- Configurable settings UI — daily limit and behavior are hardcoded
- Usage statistics / history charts
- Whitelist for specific Shorts channels
- Hiding Shorts in search results, channel pages, or Subscriptions feed
- Blocking other platforms (Reels, TikTok)

## 3. User Flows

### Flow A: First entry of the day

1. User opens `youtube.com/shorts/<id>`
2. Content script detects URL, starts sending 1-second ticks to service worker
3. Service worker accumulates `todayUsageMs`
4. User watches normally until either tab becomes hidden / they navigate away / limit reached

### Flow B: Limit reached (10 min total today)

1. Service worker detects `todayUsageMs >= 600000`
2. Service worker broadcasts a `block` message to every tab whose URL matches `*://*.youtube.com/shorts/*`
3. Each content script calls `window.location.replace(chrome.runtime.getURL('blocked.html?reason=limit'))`
4. Block page renders motivational message + "Reset at midnight — X hours Y minutes remaining"

### Flow C: User tries to bypass

1. On block page, user clicks "Just 10 more minutes" button
2. UI shows a 30-second countdown — button is disabled
3. After 30s, button enables; clicking it shows a confirm dialog: "Really watch more Shorts?"
4. On confirm, second dialog: "Are you sure? You said this would hurt your work."
5. On final confirm, service worker sets `bypassUntil = now + 600000`
6. Block page navigates back to a fresh `youtube.com/shorts` entry
7. After 10 minutes (or at next midnight, whichever first), bypass expires and limit re-applies

### Flow D: Midnight reset

1. `chrome.alarms` fires `daily-reset` at local midnight
2. Service worker sets `todayUsageMs = 0`, clears `bypassUntil`
3. If user has a Shorts tab open with the block page, the next visit (manual or via bookmark) loads normally

## 4. Architecture

Three components communicating via `chrome.runtime` messages and `chrome.storage.local`:

```
┌─────────────────────────────────────────────────────┐
│  Content Script (content.js + content.css)         │
│  - Injects CSS to hide home Shorts shelf + sidebar │
│  - On youtube.com/shorts/*: sends "tick" every 1s  │
│    when document.visibilityState === 'visible'     │
│  - Listens for "block" broadcasts → redirects      │
└──────────────────┬──────────────────────────────────┘
                   │ chrome.runtime.sendMessage
                   ▼
┌─────────────────────────────────────────────────────┐
│  Service Worker (background.js)                     │
│  - Source of truth for todayUsageMs, bypassUntil   │
│  - On tick: increment counter, check limit         │
│  - chrome.alarms('daily-reset'): zero counters     │
│  - On limit: chrome.tabs.query + sendMessage(block)│
└──────────────────┬──────────────────────────────────┘
                   │ chrome.storage.local
                   ▼
┌─────────────────────────────────────────────────────┐
│  Block Page (blocked.html + blocked.js)            │
│  - Reads countdown to midnight from storage         │
│  - 30s countdown timer for "Just 10 more" button   │
│  - 2x confirmation → sets bypassUntil → navigates  │
└─────────────────────────────────────────────────────┘
```

### Why this split

- **Service Worker as source of truth**: multiple Shorts tabs can't double-count or race. Survives tab closure.
- **Content script stays dumb**: minimal logic in YouTube's DOM context → less affected when YouTube changes markup.
- **CSS-only UI hiding**: SPA route changes don't drop the hidden elements. Works regardless of YouTube's React lifecycle.

## 5. Data Model

`chrome.storage.local` schema:

```js
{
  todayUsageMs: number,        // 0..600000 (or higher if bypass active)
  todayDateKey: string,        // "2026-05-29" — guards against missed alarms
  bypassUntil: number | null,  // epoch ms, or null
  lastTickTabId: number | null // for debugging, optional
}
```

`chrome.alarms`:

- `daily-reset` — fires at next local midnight, repeats every 1440 minutes

### Defensive reset (belt + suspenders)

On every tick, service worker compares stored `todayDateKey` with today's date. If different (user's machine was off through midnight, alarm didn't fire), zero `todayUsageMs` and update the key before incrementing. The alarm is the happy path; the date check is the safety net.

## 6. Tick Protocol

Content script in a Shorts page:

```js
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!location.pathname.startsWith('/shorts/')) return;
  chrome.runtime.sendMessage({ type: 'tick' });
}, 1000);
```

Service worker:

```js
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type !== 'tick') return;
  const state = await loadState();
  if (state.bypassUntil && Date.now() < state.bypassUntil) return; // bypass active, don't count
  if (todayKey() !== state.todayDateKey) {
    state.todayUsageMs = 0;
    state.todayDateKey = todayKey();
  }
  state.todayUsageMs += 1000;
  await saveState(state);
  if (state.todayUsageMs >= 600000) await broadcastBlock();
});
```

A 1-second cadence at sub-millisecond message cost is negligible. Tabs that go hidden naturally stop sending — Page Visibility is the user-intent signal we want.

## 7. UI Suppression (Selectors)

`content.css` is injected at `document_start` via manifest `content_scripts.css`:

```css
/* Home page Shorts shelf — multiple variants YouTube uses */
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) { display: none !important; }
ytd-reel-shelf-renderer { display: none !important; }

/* Left sidebar Shorts entry (full + mini variants) */
ytd-guide-entry-renderer a[title="Shorts"],
ytd-guide-entry-renderer a[title="쇼츠"] { display: none !important; }
ytd-mini-guide-entry-renderer[aria-label="Shorts"],
ytd-mini-guide-entry-renderer[aria-label="쇼츠"] { display: none !important; }
```

The `:has()` selector requires Chrome 105+ (Aug 2022) — universal in the Web Store user base.

Korean locale labels included since the user is Korean. If YouTube renames classes, the selector list is the only file that needs updating.

## 8. Block Page

`blocked.html` (vanilla, no framework):

- Centered card on muted background
- Title: "쇼츠 보지 마요" (or similar motivational copy — final wording TBD with user at implementation)
- Subtitle: "오늘 한도 다 썼어요. 자정까지 **X시간 Y분** 남음"
- Primary button: "돌아가기" (links to `youtube.com` home)
- Secondary button: "10분만 더" (the bypass path)

Bypass interaction:

1. Click "10분만 더" → button becomes a disabled `<span>` showing "잠시만요... 30"
2. Countdown ticks to 0 → re-enables as "정말 보시겠어요?"
3. Click → `confirm()` dialog: "정말 더 보고 싶어요?"
4. Yes → second `confirm()`: "후회 안 할 자신 있어요?"
5. Yes → `chrome.runtime.sendMessage({ type: 'bypass' })` → service worker stores `bypassUntil = now + 600000` → `window.location.href = 'https://www.youtube.com/shorts'`

## 9. Manifest (V3)

```json
{
  "manifest_version": 3,
  "name": "Shorts Blocker",
  "version": "0.1.0",
  "description": "Limit YouTube Shorts to 10 minutes a day and hide entry points.",
  "permissions": ["storage", "alarms", "tabs"],
  "host_permissions": ["*://*.youtube.com/*"],
  "background": { "service_worker": "src/background.js" },
  "content_scripts": [{
    "matches": ["*://*.youtube.com/*"],
    "js": ["src/content.js"],
    "css": ["src/content.css"],
    "run_at": "document_start"
  }],
  "web_accessible_resources": [{
    "resources": ["src/blocked.html", "src/blocked.js", "src/blocked.css"],
    "matches": ["*://*.youtube.com/*"]
  }],
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

`tabs` permission is needed for the limit-broadcast: `chrome.tabs.query({ url: '*://*.youtube.com/shorts/*' })`.

## 10. File Structure

```
shorts-blocker/
├── manifest.json
├── src/
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── blocked.html
│   ├── blocked.js
│   └── blocked.css
├── icons/
│   ├── 16.png
│   ├── 48.png
│   └── 128.png
├── docs/
│   └── superpowers/specs/2026-05-29-shorts-blocker-design.md
└── README.md
```

## 11. v0.1 → v0.2 Scope

| Capability | v0.1 (personal) | v0.2 (web store) |
|---|---|---|
| Hardcoded 10-min daily limit | ✅ | ❌ → configurable in popup |
| Block page with bypass flow | ✅ | ✅ + custom message option |
| Shorts UI suppression | ✅ | ✅ |
| Popup UI (limit slider, today usage, on/off) | ❌ | ✅ |
| Options page | ❌ | ✅ |
| i18n (Korean + English) via `_locales/` | ❌ | ✅ |
| Custom icon set | placeholder | ✅ |
| Privacy policy page | ❌ | ✅ (all data local, none transmitted) |
| Web Store assets (screenshots 1280×800, description) | ❌ | ✅ |

## 12. Technical Decisions

- **Manifest V3** — V2 is deprecated, V3 is required for new Web Store submissions.
- **Vanilla JS, no build step** — keeps v0.1 simple; revisit if v0.2 needs a popup framework.
- **`chrome.storage.local` over `sync`** — `sync` caps at 8KB per item / 100KB total and throttles writes (we write once per second); local has 10MB and no throttle.
- **CSS-only DOM suppression** — YouTube is an SPA, JS-injected hidden classes get blown away on route changes. CSS persists.
- **1-second tick granularity** — message cost is negligible, allows accurate "9:58 → blocked at 10:00" feel.
- **Page Visibility API as the watch-time signal** — matches actual user attention; tabs in background or minimized windows don't count.

## 13. Open Questions for Implementation

1. Exact motivational copy on the block page — pick during implementation with user input
2. Whether to show a small "X minutes left today" badge somewhere on the YouTube page while still under limit — defer to v0.2
3. Icon design — placeholder solid-color shape for v0.1, real design for v0.2

## 14. Out of Scope

- Whitelist for "educational" Shorts channels
- Statistics dashboard (weekly graph, daily breakdown)
- Sync across devices via Google account
- Blocking Instagram Reels, TikTok, X video, etc.
- Bypass with typed-out long-form penance ("I wasted 4 hours yesterday...") — judged ineffective since user can edit own code
