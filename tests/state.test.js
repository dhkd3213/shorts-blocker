import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey,
  applyTick,
  addBonus,
  resetDay,
  isOffActive,
  effectiveLimitMs,
  applyOff,
  turnOn,
  setLimit,
  defaultSettings,
  DEFAULT_DAILY_LIMIT_MS,
  BONUS_MS,
  OFF_DURATION_MS,
} from '../src/lib/state.js';

const baseSettings = () => ({ dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null });
const baseState = (over = {}) => ({ todayUsageMs: 0, bonusMs: 0, todayDateKey: '2026-05-29', ...over });

test('todayKey formats local date as YYYY-MM-DD', () => {
  assert.equal(todayKey(new Date(2026, 4, 29)), '2026-05-29');
});

test('todayKey pads single-digit month and day', () => {
  assert.equal(todayKey(new Date(2026, 0, 3)), '2026-01-03');
});

test('applyTick increments todayUsageMs by tickMs', () => {
  const { state: next, blocked } = applyTick(baseState(), baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('applyTick reports blocked once default limit hit', () => {
  const { state: next, blocked } = applyTick(baseState({ todayUsageMs: DEFAULT_DAILY_LIMIT_MS - 1000 }), baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(blocked, true);
});

test('applyTick respects custom dailyLimitMs from settings', () => {
  const { blocked } = applyTick(baseState({ todayUsageMs: 4000 }), { dailyLimitMs: 5000, offUntil: null }, new Date(2026, 4, 29, 10), 1000);
  assert.equal(blocked, true);
});

test('effectiveLimitMs adds bonus to base daily limit', () => {
  assert.equal(effectiveLimitMs({ bonusMs: BONUS_MS }, baseSettings()), DEFAULT_DAILY_LIMIT_MS + BONUS_MS);
});

test('applyTick does NOT block while within extended (bonus) limit', () => {
  // usage 11min, base limit 10min, but bonus 10min -> effective 20min
  const state = baseState({ todayUsageMs: 11 * 60 * 1000, bonusMs: BONUS_MS });
  const { blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(blocked, false);
});

test('applyTick blocks when usage reaches extended limit', () => {
  // usage one tick below 20min effective limit -> tick pushes to 20min -> blocked
  const state = baseState({ todayUsageMs: 20 * 60 * 1000 - 1000, bonusMs: BONUS_MS });
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, 20 * 60 * 1000);
  assert.equal(blocked, true);
});

test('applyTick counts but does NOT block while Off is active', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = baseState({ todayUsageMs: DEFAULT_DAILY_LIMIT_MS });
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() + 60000 };
  const { state: next, blocked } = applyTick(state, settings, now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS + 1000);
  assert.equal(blocked, false);
});

test('applyTick blocks immediately after Off expires when over limit', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = baseState({ todayUsageMs: DEFAULT_DAILY_LIMIT_MS + 30000 });
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() - 1000 };
  const { blocked } = applyTick(state, settings, now, 1000);
  assert.equal(blocked, true);
});

test('applyTick safety-net resets usage AND bonus when stored date is stale', () => {
  const state = baseState({ todayUsageMs: DEFAULT_DAILY_LIMIT_MS, bonusMs: BONUS_MS, todayDateKey: '2026-05-28' });
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 0, 0, 5), 1000);
  assert.equal(next.todayDateKey, '2026-05-29');
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(next.bonusMs, 0);
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

test('addBonus at the limit grants exactly 10 more real minutes', () => {
  // usage == base limit (normal block moment)
  const state = baseState({ todayUsageMs: DEFAULT_DAILY_LIMIT_MS });
  const next = addBonus(state, baseSettings());
  assert.equal(effectiveLimitMs(next, baseSettings()), DEFAULT_DAILY_LIMIT_MS + BONUS_MS);
});

test('addBonus grants 10 real minutes even when far over (Off overage trap)', () => {
  // limit 30min, watched 60min during Off -> pressing should allow 70min total
  const settings = { dailyLimitMs: 30 * 60 * 1000, offUntil: null };
  const state = baseState({ todayUsageMs: 60 * 60 * 1000, bonusMs: 0 });
  const next = addBonus(state, settings);
  assert.equal(effectiveLimitMs(next, settings), 60 * 60 * 1000 + BONUS_MS); // usage + 10min
});

test('addBonus stacks: each press adds 10 real minutes from new usage', () => {
  const settings = { dailyLimitMs: 30 * 60 * 1000, offUntil: null };
  // first press at 60min -> effective 70min
  let state = addBonus(baseState({ todayUsageMs: 60 * 60 * 1000 }), settings);
  // user watched up to 70min, blocked again, presses once more
  state = addBonus({ ...state, todayUsageMs: 70 * 60 * 1000 }, settings);
  assert.equal(effectiveLimitMs(state, settings), 80 * 60 * 1000);
});

test('addBonus never lowers an existing bonus (monotonic)', () => {
  const settings = baseSettings();
  const state = baseState({ todayUsageMs: 1000, bonusMs: 5 * 60 * 1000 });
  // needed would be tiny/negative here; bonus must stay at 5min
  assert.equal(addBonus(state, settings).bonusMs, 5 * 60 * 1000);
});

test('applyOff sets offUntil to now + 1 hour', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(applyOff(baseSettings(), now).offUntil, now.getTime() + OFF_DURATION_MS);
});

test('turnOn clears offUntil to null', () => {
  assert.equal(turnOn({ dailyLimitMs: 600000, offUntil: 1234567890 }).offUntil, null);
});
test('setLimit updates dailyLimitMs', () => {
  assert.equal(setLimit(baseSettings(), 300000).dailyLimitMs, 300000);
});
test('defaultSettings returns 10min limit, null off, hideShorts on', () => {
  const s = defaultSettings();
  assert.equal(s.dailyLimitMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(s.offUntil, null);
  assert.equal(s.hideShorts, true);
});

test('resetDay zeros usage AND bonus, updates date', () => {
  const next = resetDay(baseState({ todayUsageMs: 600000, bonusMs: BONUS_MS }), new Date(2026, 4, 30));
  assert.equal(next.todayUsageMs, 0);
  assert.equal(next.bonusMs, 0);
  assert.equal(next.todayDateKey, '2026-05-30');
});
