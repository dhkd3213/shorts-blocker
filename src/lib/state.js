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
  if (working.bypassUntil && now.getTime() < working.bypassUntil) {
    return { state: working, blocked: false };
  }
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
