// The dashboard's five tiles, mapped off the wire.
//
// The bug these guard: getDashboard()'s live branch ignored the payload it had just
// fetched and returned literals — todaysAppointments: 0, satisfactionPct: 0,
// earnings.lifetimeKobo = walletBalanceKobo — because the doctor was booking into
// public.appointments while the counts were read from doctor_appointments, which
// nothing writes. The endpoint answered 200 with real data and the screen still
// showed a doctor with no patients. GET /dashboard was typed `Generic` in the
// contract, so nothing caught the mismatch.
//
// Runner: npm run test:doctor-mapping  (the glob #1008 added already covers this
// directory; this package has no jest, and
// src/features/doctor/__tests__/batch6Wire.test.ts set the precedent).

import test from 'node:test';
import assert from 'node:assert/strict';

import { avatarColorFor } from '@/features/telemedicine/mapping';
import { mapAppointmentWire } from '@/features/doctor/mapping';

import {
  mapDashboardWire,
  mapQueueAppointment,
  formatSlotDateLabel,
  type DashboardWire,
} from '../dashboardWire.ts';

const QUEUE_ROW = {
  id: 'a1',
  ref: 'TM-9F2A41',
  patient: { id: 'p1', name: 'Tunde Akinwale', age: 34, gender: 'male' },
  consultType: 'video',
  status: 'upcoming',
  slotDate: '2026-11-13',
  slotTime: '09:00 AM',
  feeKobo: 750000,
  reason: 'headache for a week',
  isHmo: false,
  createdAt: '2026-11-10T08:00:00Z',
};

const FULL: DashboardWire = {
  appointmentCounts: { pending: 3, completed: 9 },
  unreadNotifications: 2,
  walletBalanceKobo: 500000,
  currency: 'NGN',
  metrics: {
    todaysCount: 3,
    upcomingCount: 5,
    satisfactionPct: 96,
    ratingCount: 24,
    revenue: { pendingKobo: 170000, lifetimeKobo: 2040000, thisMonthKobo: 510000, consultsThisMonth: 12 },
    timezone: 'Africa/Lagos',
    today: '2026-11-13',
  },
  todaysAppointments: [QUEUE_ROW],
};

test('every tile reads the wire, not a literal', () => {
  const d = mapDashboardWire(FULL);
  assert.equal(d.counts.todaysAppointments, 3);
  assert.equal(d.counts.upcomingAppointments, 5);
  assert.equal(d.satisfactionPct, 96);
  assert.equal(d.earnings.availableKobo, 500000);
  assert.equal(d.earnings.pendingKobo, 170000);
  assert.equal(d.earnings.lifetimeKobo, 2040000);
  assert.equal(d.earnings.thisMonthKobo, 510000);
  assert.equal(d.earnings.consultsThisMonth, 12);
  assert.equal(d.todaysAppointments.length, 1);
  // The wallet is not consult revenue — the old code used one for both.
  assert.notEqual(d.earnings.lifetimeKobo, d.earnings.availableKobo);
  // Untouched reads still feed their own tiles.
  assert.equal(d.counts.pendingRequests, 3);
  assert.equal(d.counts.unreadMessages, 2);
});

test('no reviews is null, which the tile renders as an em dash', () => {
  const d = mapDashboardWire({ ...FULL, metrics: { ...FULL.metrics, satisfactionPct: null, ratingCount: 0 } });
  assert.equal(d.satisfactionPct, null);
  // A real 0 must stay 0 — 'nobody reviewed you' and 'everyone rated you 1 star'
  // are different messages to a doctor.
  assert.equal(mapDashboardWire({ ...FULL, metrics: { ...FULL.metrics, satisfactionPct: 0 } }).satisfactionPct, 0);
});

test('a thin wire yields zeros and empty arrays, never undefined', () => {
  // The literal body of an endpoint that predates the metrics field, or a doctor
  // with nothing at all.
  const d = mapDashboardWire({});
  assert.equal(d.counts.todaysAppointments, 0);
  assert.equal(d.counts.upcomingAppointments, 0);
  assert.equal(d.satisfactionPct, null);
  assert.deepEqual(d.todaysAppointments, []);
  assert.equal(d.earnings.availableKobo, 0);
  assert.equal(d.earnings.pendingKobo, 0);
  assert.deepEqual(d.earnings.payouts, []);
  assert.deepEqual(d.alerts, []);
  assert.deepEqual(d.messages, []);
  assert.deepEqual(d.waitingRoom, []);
});

test('a queue row becomes the DoctorAppointment the row component expects', () => {
  const a = mapQueueAppointment(QUEUE_ROW);
  assert.equal(a.id, 'a1');
  assert.equal(a.ref, 'TM-9F2A41');
  assert.equal(a.slotDate, '2026-11-13');
  assert.equal(a.slotTime, '09:00 AM');
  assert.equal(a.status, 'upcoming');
  assert.equal(a.feeKobo, 750000);
  assert.equal(a.reason, 'headache for a week');
  assert.equal(a.isHmo, false);
  assert.equal(a.patient.name, 'Tunde Akinwale');
  assert.equal(a.patient.gender, 'male');
  // Presentation tokens come off the platform rule, not a dashboard-local guess.
  assert.equal(a.patient.initials, 'TA');
  assert.equal(a.patient.avatarColor, avatarColorFor('p1'));
});

test('in_person passes through rather than becoming a video consult', () => {
  // appointments.consultation_type allows in_person; ConsultType does not (F4
  // tracks widening it). mapAppointmentWire routes this field through
  // mapConsultType, which collapses anything unrecognised to 'video' and has that
  // collapse under test of its own (__tests__/mapping.appointments.test.ts:62) —
  // so delegating the rest of the row still has to stop here, or an in-person
  // visit displays as a video call (spec D8). AppointmentRow draws a fallback
  // icon for it (Task 6).
  const wire = { ...QUEUE_ROW, consultType: 'in_person' };
  assert.equal(mapQueueAppointment(wire).consultType, 'in_person');
  assert.equal(mapAppointmentWire(wire).consultType, 'video');
});

test('the queue row and the appointments list are the same row', () => {
  // The delegation contract: one patient, one avatar, one status vocabulary, no
  // matter which screen asks. If mapQueueAppointment ever grows its own rules,
  // this is the test that says so.
  const dash = mapQueueAppointment(QUEUE_ROW);
  const list = mapAppointmentWire(QUEUE_ROW);
  assert.equal(dash.patient.initials, list.patient.initials);
  assert.equal(dash.patient.avatarColor, list.patient.avatarColor);
  assert.equal(dash.patient.gender, list.patient.gender);
  assert.equal(dash.status, list.status);
  assert.equal(dash.ref, list.ref);
  assert.equal(dash.slotDate, list.slotDate);
  assert.equal(dash.slotTime, list.slotTime);
  assert.equal(dash.feeKobo, list.feeKobo);
  assert.equal(dash.isHmo, list.isHmo);
  // consultType matches too, because 'video' is a type both planes recognise.
  assert.equal(dash.consultType, list.consultType);
});

test('an unrecognised status cannot invent a completed badge', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, status: 'archived' }).status, 'upcoming');
});

test('an unknown gender maps to the union member that is not a claim', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: { ...QUEUE_ROW.patient, gender: 'non-binary' } }).patient.gender, 'other');
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: {} }).patient.gender, 'other');
  // Case-folded by the shared rule: 'Female' is a female patient, not 'other'.
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: { ...QUEUE_ROW.patient, gender: 'Female' } }).patient.gender, 'female');
});

test('the slot date label survives a full timestamp', () => {
  // The whole reason the queue looked broken: 'Nov 13' vs 'Invalid Date'.
  assert.equal(formatSlotDateLabel('2026-11-13'), 'Nov 13');
  assert.equal(formatSlotDateLabel('2026-11-13T10:00:00.000Z'), 'Nov 13');
});
