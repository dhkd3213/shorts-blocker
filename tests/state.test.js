import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey,
  applyTick,
  startBypass,
  resetDay,
  DAILY_LIMIT_MS,
  BYPASS_DURATION_MS,
} from '../src/lib/state.js';

test('todayKey formats local date as YYYY-MM-DD', () => {
  const d = new Date(2026, 4, 29); // May 29 (month index 4)
  assert.equal(todayKey(d), '2026-05-29');
});

test('todayKey pads single-digit month and day', () => {
  const d = new Date(2026, 0, 3); // Jan 3
  assert.equal(todayKey(d), '2026-01-03');
});

test('applyTick increments todayUsageMs by tickMs', () => {
  const state = { todayUsageMs: 0, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('applyTick reports blocked once limit hit', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS - 1000, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS);
  assert.equal(blocked, true);
});

test('applyTick does not increment while bypass is active', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: now.getTime() + 60000,
  };
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS);
  assert.equal(blocked, false);
});

test('applyTick resumes counting once bypass expires', () => {
  const now = new Date(2026, 4, 29, 10);
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: now.getTime() - 1000, // already expired
  };
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayUsageMs, DAILY_LIMIT_MS + 1000);
  assert.equal(blocked, true);
});

test('applyTick safety-net resets when stored date is stale', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS, todayDateKey: '2026-05-28', bypassUntil: null };
  const now = new Date(2026, 4, 29, 0, 0, 5);
  const { state: next, blocked } = applyTick(state, now, 1000);
  assert.equal(next.todayDateKey, '2026-05-29');
  assert.equal(next.todayUsageMs, 1000);
  assert.equal(blocked, false);
});

test('startBypass sets bypassUntil = now + BYPASS_DURATION_MS', () => {
  const state = { todayUsageMs: DAILY_LIMIT_MS, todayDateKey: '2026-05-29', bypassUntil: null };
  const now = new Date(2026, 4, 29, 10);
  const next = startBypass(state, now);
  assert.equal(next.bypassUntil, now.getTime() + BYPASS_DURATION_MS);
});

test('resetDay zeros usage, clears bypass, updates date', () => {
  const state = {
    todayUsageMs: DAILY_LIMIT_MS,
    todayDateKey: '2026-05-29',
    bypassUntil: 1234567890,
  };
  const now = new Date(2026, 4, 30);
  const next = resetDay(state, now);
  assert.equal(next.todayUsageMs, 0);
  assert.equal(next.todayDateKey, '2026-05-30');
  assert.equal(next.bypassUntil, null);
});
