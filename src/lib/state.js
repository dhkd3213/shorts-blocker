export const DEFAULT_DAILY_LIMIT_MS = 10 * 60 * 1000;
export const BONUS_MS = 10 * 60 * 1000; // "10분 더 보기" adds this to today's effective limit
export const OFF_DURATION_MS = 60 * 60 * 1000; // Off auto-returns to ON after 1 hour

export function todayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function defaultSettings() {
  return { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null, hideShorts: true };
}

export function isOffActive(settings, now) {
  const off = settings?.offUntil;
  if (off == null) return false;
  return now.getTime() < off;
}

// Effective limit = base daily limit + today's bonus (from "10분 더 보기")
export function effectiveLimitMs(state, settings) {
  const base = settings?.dailyLimitMs ?? DEFAULT_DAILY_LIMIT_MS;
  return base + (state?.bonusMs ?? 0);
}

export function applyTick(state, settings, now, tickMs) {
  let working = state;
  const key = todayKey(now);
  if (working.todayDateKey !== key) {
    working = { ...working, todayUsageMs: 0, bonusMs: 0, todayDateKey: key };
  }
  // Off: keep counting (honest tracking), never block
  const next = { ...working, todayUsageMs: working.todayUsageMs + tickMs };
  if (isOffActive(settings, now)) {
    return { state: next, blocked: false };
  }
  const blocked = next.todayUsageMs >= effectiveLimitMs(next, settings);
  return { state: next, blocked };
}

// "10분 더 보기": extend today's limit by BONUS_MS (counting continues normally)
export function addBonus(state) {
  return { ...state, bonusMs: (state.bonusMs ?? 0) + BONUS_MS };
}

export function applyOff(settings, now) {
  return { ...settings, offUntil: now.getTime() + OFF_DURATION_MS };
}

export function turnOn(settings) {
  return { ...settings, offUntil: null };
}

export function setLimit(settings, limitMs) {
  return { ...settings, dailyLimitMs: limitMs };
}

export function resetDay(state, now) {
  return { ...state, todayUsageMs: 0, bonusMs: 0, todayDateKey: todayKey(now) };
}
