// What a doctor detail read answers when there is no row.
//
// The bug these guard is the react-query contract the announcement crash taught
// (see mapping.test.ts): query-core rejects an `undefined` queryFn result
// outright — `if (data === undefined) throw` — so a query that has nothing to
// show must answer `null`, which it accepts as data.
//
// Two of the doctor reads still resolved `undefined`, from both branches:
//   - getAppointment         (src/api/doctor.api.ts)
//   - getAppointmentRequest  (src/api/doctor.batch1.api.ts)
// In mock mode `Array.prototype.find` returns undefined for an id the fixtures
// do not carry — a deep link, or a stale route param after the demo list
// changed — and the live branch wrote a literal `: undefined`. Only demo mode
// can hit it today (every deployed env is mockless, config/mockPolicy.ts), but
// it is the same crash with the same fix, so it goes through the one rule here.
//
// The api modules themselves cannot be imported under `node --test`: they reach
// @/api/client, which pulls expo-router and the supabase polyfill — the same
// reason authError.ts is kept pure and authRedirect.ts is not. So the rule lives
// in this mapper and the api layer calls it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { orNull } from '../mapping.ts';

test('a fixture miss (Array.find → undefined) becomes null', () => {
  // assert.equal is strict, so this fails on `undefined`.
  assert.equal(orNull(undefined), null);
});

test('a 200 with a null body stays null', () => {
  assert.equal(orNull(null), null);
});

test('a found row passes through as the same object', () => {
  const row = { id: '3dbec672-cebe-4dc8-974d-46c647467930' };
  assert.equal(orNull(row), row);
});
