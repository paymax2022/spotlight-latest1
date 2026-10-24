// node --experimental-strip-types --test "src/features/restaurantmerchant/__tests__/hours.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyToAll, emptyWeek, formatMinute, summarizeWeek, toMinutes, validateWeek,
  weekFromWindows, windowsFromWeek,
} from '../hours.ts';
import type { StoreHourWindow } from '../types.ts';

const win = (dayOfWeek: number, open: string, close: string): StoreHourWindow => ({ dayOfWeek, open, close });

test('an empty week has seven closed days, Sunday first', () => {
  const w = emptyWeek();
  assert.equal(w.length, 7);
  assert.deepEqual(w.map((d) => d.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(w.every((d) => !d.open));
});

test('windows become editable rows and back again, with no day invented', () => {
  const windows = [win(1, '08:30', '22:00'), win(6, '10:00', '24:00')];
  const rows = weekFromWindows(windows);
  assert.equal(rows[1].open, true);
  assert.equal(rows[1].from, '08:30');
  assert.equal(rows[0].open, false);
  assert.deepEqual(windowsFromWeek(rows), windows);
});

test('a week with nothing switched on saves as an empty schedule', () => {
  assert.deepEqual(windowsFromWeek(emptyWeek()), []);
});

test('closing earlier than opening is an overnight window, not a mistake', () => {
  const rows = weekFromWindows([win(5, '20:00', '02:00')]);
  assert.equal(validateWeek(rows), null);
});

test('a zero-length window is refused with the day named', () => {
  const rows = weekFromWindows([win(3, '10:00', '10:00')]);
  const problem = validateWeek(rows);
  assert.ok(problem);
  assert.match(problem!, /Wednesday/);
});

test('a junk time is refused, and 24:00 can open but never close a day wrongly', () => {
  const rows = weekFromWindows([win(0, '25:00', '27:00')]);
  assert.ok(validateWeek(rows));
  assert.equal(toMinutes('24:00'), 1440);
  assert.equal(toMinutes('24:01'), null);
  assert.equal(toMinutes('9:30'), 570);
  assert.equal(toMinutes('09:60'), null);
  assert.equal(toMinutes(''), null);
  // An owner who sets 24:00 as an OPENING time means nothing the server can honour.
  assert.ok(validateWeek([{ dayOfWeek: 2, open: true, from: '24:00', to: '23:00' }]));
});

test('a closed day is never validated, so its leftover times can’t block the save', () => {
  const rows = emptyWeek();
  rows[4] = { dayOfWeek: 4, open: false, from: 'nonsense', to: 'nonsense' };
  assert.equal(validateWeek(rows), null);
  assert.deepEqual(windowsFromWeek(rows), []);
});

test('copy to all week applies one day’s switch and times to every day', () => {
  const rows = weekFromWindows([win(2, '07:00', '19:00')]);
  const all = copyToAll(rows, 2);
  assert.ok(all.every((d) => d.open && d.from === '07:00' && d.to === '19:00'));
  assert.equal(rows[2].open, true); // the source row is untouched, not mutated
});

test('formatMinute renders midnight-closing windows the way the editor shows them', () => {
  assert.equal(formatMinute(0), '00:00');
  assert.equal(formatMinute(570), '09:30');
  assert.equal(formatMinute(1440), '24:00');
});

test('the summary collapses a repeated window into a day range', () => {
  const rows = weekFromWindows([
    win(1, '09:00', '17:00'), win(2, '09:00', '17:00'), win(3, '09:00', '17:00'),
    win(4, '09:00', '17:00'), win(5, '09:00', '17:00'),
  ]);
  assert.equal(summarizeWeek(rows), 'Mon–Fri 09:00–17:00');
});

test('the summary lists differing days separately and says so when there is no schedule', () => {
  const rows = weekFromWindows([win(0, '12:00', '21:00'), win(6, '10:00', '23:00')]);
  assert.equal(summarizeWeek(rows), 'Sun 12:00–21:00, Sat 10:00–23:00');
  assert.match(summarizeWeek(emptyWeek()), /No set hours/);
});
