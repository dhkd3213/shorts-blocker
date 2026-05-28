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
