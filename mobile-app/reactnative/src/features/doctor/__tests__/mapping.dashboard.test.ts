// The dashboard tiles and "Today's queue", as one pure rule.
//
// Both halves of this were fabricated on the client. `getDashboard()`'s live
// normalizer (src/api/doctor.batch1.api.ts) wrote literal `0`s for
// `counts.todaysAppointments`, `counts.upcomingAppointments` and
// `satisfactionPct`, so the screen's `?? todays.length` / `?? 0` fallbacks could
// never fire — `0` is not nullish — and three of the four tiles read zero while
// real bookings sat on the same account. The list below the tiles is filtered by
// STATUS only, which is how a booking three days out appeared under
// "Today's queue".
//
// The server now counts both tiles and the day it counted (internal/doctor
// DashboardDayCounts, in the doctor's own timezone), so the client's job is to
// pass those through and to filter the preview by the day the server named —
// not by the device's, which is the bug for a doctor travelling across offsets.
//
// The api module itself cannot be imported under `node --test` (it reaches
// @/api/client → expo-router and the supabase polyfill), so the rules live in
// this mapper and the api layer and the screen call them — the same split as
// orNull and mapHeaderAvatar.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dashboardTilesFromWire, isTodaySlot } from '../mapping.ts';

test('the tile numbers the server counted reach the tiles', () => {
  const tiles = dashboardTilesFromWire({
    todaysAppointments:   2,
    upcomingAppointments: 5,
    satisfactionPct:      90,
    todayDate:            '2026-11-15',
  });
  assert.equal(tiles.todaysAppointments, 2);
  assert.equal(tiles.upcomingAppointments, 5);
  assert.equal(tiles.satisfactionPct, 90);
  assert.equal(tiles.todayDate, '2026-11-15');
});

test('a wire with none of them answers zeroed numbers, not undefined', () => {
  const tiles = dashboardTilesFromWire({});
  assert.equal(tiles.todaysAppointments, 0);
  assert.equal(tiles.upcomingAppointments, 0);
  assert.equal(tiles.satisfactionPct, 0);
  assert.equal(tiles.todayDate, undefined);
});

test('a null the server answers is not a number', () => {
  // JSON `null` reaches the client as null, and `String(null)` would put "null"
  // in the tile.
  const tiles = dashboardTilesFromWire({ todaysAppointments: null, satisfactionPct: null });
  assert.equal(tiles.todaysAppointments, 0);
  assert.equal(tiles.satisfactionPct, 0);
});

test("today's queue drops a row dated outside the day the server counted", () => {
  assert.equal(isTodaySlot('2026-11-18', '2026-11-15'), false);
  assert.equal(isTodaySlot('2026-11-15', '2026-11-15'), true);
});

test('without a server day the preview stays status-filtered, not hidden', () => {
  // An older wire (or demo mode) carries no day; filtering everything out would
  // empty the section that used to at least show the real schedule.
  assert.equal(isTodaySlot('2026-11-18', undefined), true);
  assert.equal(isTodaySlot('', '2026-11-15'), false);
});
