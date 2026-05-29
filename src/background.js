import {
  applyTick,
  addBonus,
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
  return { todayUsageMs: 0, bonusMs: 0, todayDateKey: todayKey(new Date()) };
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
        sendResponse({
          ok: true,
          todayUsageMs: next.todayUsageMs,
          dailyLimitMs: settings.dailyLimitMs,
          bonusMs: next.bonusMs ?? 0,
          offUntil: settings.offUntil,
          blocked,
        });
      } else if (msg?.type === 'bypass') {
        const [state, settings] = await Promise.all([loadState(), loadSettings()]);
        await saveState(addBonus(state, settings));
        sendResponse({ ok: true });
      } else if (msg?.type === 'getStatus') {
        const [state, settings] = await Promise.all([loadState(), loadSettings()]);
        sendResponse({ ok: true, ...state, ...settings, bonusMs: state.bonusMs ?? 0, now: Date.now() });
      } else if (msg?.type === 'setLimit') {
        const settings = await loadSettings();
        const updated = setLimit(settings, msg.limitMs);
        await saveSettings(updated);
        const state = await loadState();
        const effLimit = updated.dailyLimitMs + (state.bonusMs ?? 0);
        if (!isOffActive(updated, new Date()) && state.todayUsageMs >= effLimit) {
          await broadcastBlock();
        }
        sendResponse({ ok: true });
      } else if (msg?.type === 'setOff') {
        const settings = await loadSettings();
        const updated = applyOff(settings, new Date());
        await saveSettings(updated);
        scheduleOffExpire(updated.offUntil);
        sendResponse({ ok: true });
      } else if (msg?.type === 'turnOn') {
        const settings = await loadSettings();
        await saveSettings(turnOn(settings));
        chrome.alarms.clear(OFF_ALARM);
        sendResponse({ ok: true });
      } else if (msg?.type === 'setHideShorts') {
        const settings = await loadSettings();
        await saveSettings({ ...settings, hideShorts: !!msg.value });
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
