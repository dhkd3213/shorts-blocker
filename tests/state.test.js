import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey,
  applyTick,
  startBypass,
  resetDay,
  isOffActive,
  applyOff,
  turnOn,
  setLimit,
  defaultSettings,
  DEFAULT_DAILY_LIMIT_MS,
  BYPASS_DURATION_MS,
  OFF_DURATIONS,
} from '../src/lib/state.js';

const baseSettings = () => ({ dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: null });

test('todayKey formats local date as YYYY-MM-DD', () => {
  assert.equal(todayKey(new Date(2026, 4, 29)), '2026-05-29');
});

test('todayKey pads single-digit month and day', () => {
  assert.equal(todayKey(new Date(2026, 0, 3)), '2026-01-03');
});

test('applyTick increments todayUsageMs by tickMs', () => {
  const state = { todayUsageMs: 0, todayDateKey: '2026-05-29', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('applyTick reports blocked once default limit hit', () => {
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS - 1000, todayDateKey: '2026-05-29', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 10), 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(blocked, true);
});

test('applyTick respects custom dailyLimitMs from settings', () => {
  const state = { todayUsageMs: 4000, todayDateKey: '2026-05-29', bypassUntil: null };
  const { blocked } = applyTick(state, { dailyLimitMs: 5000, offUntil: null }, new Date(2026, 4, 29, 10), 1000);
  assert.equal(blocked, true);
});

test('applyTick does not count or block during block-page bypass', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: now.getTime() + 60000 };
  const { state: next, blocked } = applyTick(state, baseSettings(), now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(blocked, false);
});

test('applyTick counts but does NOT block while Off is active', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() + 60000 };
  const { state: next, blocked } = applyTick(state, settings, now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS + 1000);
  assert.equal(blocked, false);
});

test('applyTick blocks immediately after Off expires when over limit', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS + 30000, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: now.getTime() - 1000 };
  const { blocked } = applyTick(state, settings, now, 1000);
  assert.equal(blocked, true);
});

test('applyTick infinite Off counts but never blocks', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS * 5, todayDateKey: '2026-05-29', bypassUntil: null };
  const settings = { dailyLimitMs: DEFAULT_DAILY_LIMIT_MS, offUntil: 'infinite' };
  const { state: next, blocked } = applyTick(state, settings, now, 1000);
  assert.equal(next.todayUsageMs, DEFAULT_DAILY_LIMIT_MS * 5 + 1000);
  assert.equal(blocked, false);
});

test('applyTick safety-net resets when stored date is stale', () => {
  const state = { todayUsageMs: DEFAULT_DAILY_LIMIT_MS, todayDateKey: '2026-05-28', bypassUntil: null };
  const { state: next, blocked } = applyTick(state, baseSettings(), new Date(2026, 4, 29, 0, 0, 5), 1000);
  assert.equal(next.todayDateKey, '2026-05-29');
  assert.equal(next.todayUsageMs, 1000);
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
test('isOffActive: "infinite" = off', () => {
  assert.equal(isOffActive({ offUntil: 'infinite' }, new Date(2026, 4, 29, 10)), true);
});

test('applyOff 15min sets offUntil to now + 15min', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(applyOff(baseSettings(), '15min', now).offUntil, now.getTime() + OFF_DURATIONS['15min']);
});
test('applyOff 1hour sets offUntil to now + 1hour', () => {
  const now = new Date(2026, 4, 29, 10);
  assert.equal(applyOff(baseSettings(), '1hour', now).offUntil, now.getTime() + OFF_DURATIONS['1hour']);
});
test('applyOff infinite sets offUntil to "infinite"', () => {
  assert.equal(applyOff(baseSettings(), 'infinite', new Date(2026, 4, 29, 10)).offUntil, 'infinite');
});

test('turnOn clears offUntil to null', () => {
  assert.equal(turnOn({ dailyLimitMs: 600000, offUntil: 'infinite' }).offUntil, null);
});
test('setLimit updates dailyLimitMs', () => {
  assert.equal(setLimit(baseSettings(), 300000).dailyLimitMs, 300000);
});
test('defaultSettings returns 10min limit and null off', () => {
  const s = defaultSettings();
  assert.equal(s.dailyLimitMs, DEFAULT_DAILY_LIMIT_MS);
  assert.equal(s.offUntil, null);
});

test('startBypass sets bypassUntil = now + BYPASS_DURATION_MS', () => {
  const now = new Date(2026, 4, 29, 10);
  const next = startBypass({ todayUsageMs: 600000, todayDateKey: '2026-05-29', bypassUntil: null }, now);
  assert.equal(next.bypassUntil, now.getTime() + BYPASS_DURATION_MS);
});
test('resetDay zeros usage, clears bypass, updates date', () => {
  const next = resetDay({ todayUsageMs: 600000, todayDateKey: '2026-05-29', bypassUntil: 123 }, new Date(2026, 4, 30));
  assert.equal(next.todayUsageMs, 0);
  assert.equal(next.todayDateKey, '2026-05-30');
  assert.equal(next.bypassUntil, null);
});
