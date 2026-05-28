import {
  applyTick,
  startBypass,
  resetDay,
  todayKey,
} from './lib/state.js';

const STORAGE_KEY = 'state';
const SHORTS_URL_MATCH = '*://*.youtube.com/shorts/*';
const ALARM_NAME = 'daily-reset';

let queue = Promise.resolve();
function serialize(work) {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

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
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  serialize(async () => {
    const state = await loadState();
    await saveState(resetDay(state, new Date()));
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  serialize(async () => {
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
  });
  return true; // async sendResponse
});
