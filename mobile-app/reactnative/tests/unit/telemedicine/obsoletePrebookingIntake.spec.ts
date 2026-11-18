// The obsolete pre-booking intake link must land on booking, not on a dead end.
//
// The bug these guard: intake used to be launched from the doctor profile under a
// synthetic id `pre-<doctorId>`. ADR-010 keys the intake to an appointment
// (health_preconsult_intake references one), so that id was never resolvable — and
// commit bfa61d6ff (2026-11-12) moved the wizard after payment and deleted every
// in-app generator of the `pre-` link. Links already sent out did not disappear
// with them: app/services/telemedicine/appointment/[id]/intake/index.tsx mounted
// with appointmentId='pre-<uuid>', GET /intake/appointments/pre-<uuid> answered
// 400 {"error":"appointmentId must be a uuid"} (the contract internal/health/
// preconsult/handler_uuid_test.go pins), and the screen showed
// "Couldn't load intake / Please try again." with a Retry that re-fires the same
// 400 forever. Verified live on 2026-11-12 against :3000 with a real session.
//
// The recovery is the destination the current flow uses: the doctor's booking
// screen, which is how an appointment id gets created at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveObsoletePrebookingRoute,
  BOOKING_SCREEN,
} from '@/features/telemedicine/intakeRoute';

test('the pre-booking link reported by a patient redirects to booking', () => {
  const doctorId = '687f6cf3-1e33-477c-9fe9-036c57f7a757';
  assert.deepEqual(
    resolveObsoletePrebookingRoute(`pre-${doctorId}`, doctorId),
    { pathname: BOOKING_SCREEN, params: { id: doctorId } },
  );
});

test('a repeated query param does not crash the rescue', () => {
  // useLocalSearchParams yields string[] when a link repeats a param, so the
  // screen this is meant to save would otherwise throw on .trim().
  assert.deepEqual(
    resolveObsoletePrebookingRoute('pre-', ['doctor-d', 'doctor-e']),
    { pathname: BOOKING_SCREEN, params: { id: 'doctor-d' } },
  );
  assert.deepEqual(
    resolveObsoletePrebookingRoute(['pre-doctor-f']),
    { pathname: BOOKING_SCREEN, params: { id: 'doctor-f' } },
  );
});

test('a real appointment id is not obsolete, so the wizard runs', () => {
  assert.equal(
    resolveObsoletePrebookingRoute('2f1c9b0a-0d3e-4e5f-8a7b-1c2d3e4f5a6b'),
    undefined,
  );
});

test('the id prefix decides, even when the query param disagrees', () => {
  // The link carries the doctor id twice; the path segment is what the wizard was
  // opened with, so it wins rather than silently booking a different doctor.
  assert.deepEqual(
    resolveObsoletePrebookingRoute('pre-doctor-a', 'doctor-b'),
    { pathname: BOOKING_SCREEN, params: { id: 'doctor-a' } },
  );
});

test('a bare pre- falls back to the doctorId param', () => {
  assert.deepEqual(
    resolveObsoletePrebookingRoute('pre-', 'doctor-c'),
    { pathname: BOOKING_SCREEN, params: { id: 'doctor-c' } },
  );
});

test('nothing recoverable means no redirect, so the screen keeps its own error', () => {
  assert.equal(resolveObsoletePrebookingRoute('pre-'), undefined);
  assert.equal(resolveObsoletePrebookingRoute('pre-', ''), undefined);
  assert.equal(resolveObsoletePrebookingRoute(''), undefined);
  assert.equal(resolveObsoletePrebookingRoute(undefined), undefined);
});
