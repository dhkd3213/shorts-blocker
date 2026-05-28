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
