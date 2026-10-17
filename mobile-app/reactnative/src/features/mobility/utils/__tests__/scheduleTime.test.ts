import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineLocal,
  localDate,
  localTime,
  scheduleTimeError,
  defaultScheduleTime,
  MIN_LEAD_MINUTES,
  MAX_LEAD_DAYS,
} from '../scheduleTime.ts';

test('combineLocal builds the instant for the chosen local date and time', () => {
  const iso = combineLocal('2026-10-20', '14:30');
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 20);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 30);
});

test('combineLocal returns empty until both parts are set and valid', () => {
  assert.equal(combineLocal(undefined, '10:00'), '');
  assert.equal(combineLocal('2026-10-20', ''), '');
  assert.equal(combineLocal('2026-13-99', '10:00'), '');
  assert.equal(combineLocal('2026-02-31', '10:00'), '');
  assert.equal(combineLocal('2026-10-20', '25:00'), '');
});

test('localDate and localTime read back what combineLocal wrote', () => {
  const iso = combineLocal('2026-03-05', '07:05');
  assert.equal(localDate(iso), '2026-03-05');
  assert.equal(localTime(iso), '07:05');
});

test('a time too soon is refused, one just past the lead time is accepted', () => {
  const now = new Date(2026, 9, 16, 10, 0, 0, 0);
  const tooSoon = new Date(now.getTime() + (MIN_LEAD_MINUTES - 5) * 60_000).toISOString();
  const ok = new Date(now.getTime() + (MIN_LEAD_MINUTES + 5) * 60_000).toISOString();
  assert.match(scheduleTimeError(tooSoon, now) ?? '', /at least 30 minutes/);
  assert.equal(scheduleTimeError(ok, now), null);
});

test('a time beyond the booking horizon is refused', () => {
  const now = new Date(2026, 9, 16, 10, 0, 0, 0);
  const far = new Date(now.getTime() + (MAX_LEAD_DAYS + 1) * 86_400_000).toISOString();
  assert.match(scheduleTimeError(far, now) ?? '', /up to 30 days/);
});

test('an empty or invalid time is refused with a clear message', () => {
  assert.match(scheduleTimeError('') ?? '', /Choose a date and time/);
  assert.match(scheduleTimeError('not a date') ?? '', /valid date and time/);
});

test('the default time is a valid, bookable time', () => {
  const now = new Date(2026, 9, 16, 10, 50, 0, 0);
  const d = defaultScheduleTime(now);
  assert.equal(scheduleTimeError(d, now), null);
});
