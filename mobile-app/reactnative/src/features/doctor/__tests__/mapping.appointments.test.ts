// The wire→domain mapping for the doctor's appointment plane.
//
// The bug these guard: a patient booking writes exactly ONE row, into
// public.appointments (backend/internal/telemedicine/service.go). The portal's
// Go reads were pointed at doctor_appointments / doctor_appointment_requests —
// tables nothing in this repository ever inserts into — so the booking at
// /services/telemedicine/appointment/3dbec672… sat on "Awaiting doctor
// confirmation" while app/(doctor)/appointments said "No appointments".
//
// The reads now answer real rows, and `model.go Appointment` is not what the
// screens were written against: it carries no `initials`, no `avatarColor`, and
// a `consultType` the inbox indexes into `Record<ConsultType, LucideIcon>`.
// Passed straight through, the first live row renders an empty avatar beside the
// patient's name and then throws on `<TypeIcon>` — the same defect class as the
// profile header, which mapHeaderAvatar already fixes. So the server answers
// data and the client fills presentation, from the one set of rules the patient
// plane uses, so a person keeps one face across both.
//
// Fixtures are the LITERAL JSON the doctor handler writes for an `appointments`
// row (backend/internal/doctor/appointments_plane_live_db_test.go pins it).

import test from 'node:test';
import assert from 'node:assert/strict';

import { avatarColorFor, referenceFor } from '@/features/telemedicine/mapping';
import { mapAppointmentWire, mapRequestWire } from '../mapping.ts';

const APPT_ID = '3dbec672-cebe-4dc8-974d-46c647467930';
const PATIENT_ID = 'b2f1a55e-6a0e-4f6c-8f0a-2c4d6e8f0a11';

const LIVE_ROW = {
  id: APPT_ID,
  userId: 'ed2c401b-44b4-4074-9a1a-756b3e256225',
  ref: 'TM-3DBEC6',
  patientId: PATIENT_ID,
  patient: { id: PATIENT_ID, name: 'Chidi Okeke', age: 45, gender: 'male' },
  consultType: 'video',
  status: 'upcoming',
  slotDate: '2026-11-14',
  slotTime: '12:00 PM',
  feeKobo: 200000,
  reason: 'Recurring abdominal pain',
  isHmo: false,
  createdAt: '2026-11-13T09:12:00Z',
};

test('a live row gets the avatar the card renders, from the same rule as the patient plane', () => {
  const a = mapAppointmentWire(LIVE_ROW);
  assert.equal(a.patient.initials, 'CO');
  assert.equal(a.patient.avatarColor, avatarColorFor(PATIENT_ID));
});

test('the server\'s slot pair passes through verbatim', () => {
  // The Go read formats slotDate/slotTime in the DOCTOR'S timezone
  // (doctor_availability.timezone). Rebuilding them from a client Date would
  // shift the day for any doctor whose device is not on WAT.
  const a = mapAppointmentWire(LIVE_ROW);
  assert.equal(a.slotDate, '2026-11-14');
  assert.equal(a.slotTime, '12:00 PM');
});

test('a consultType the app has no icon for still lands on one it does', () => {
  // requests/index.tsx does `TYPE_ICON[r.appointment.consultType]` and renders
  // the result — an unmapped value is `undefined`, which React throws on.
  for (const raw of ['video', 'audio', 'chat', 'in_person', undefined]) {
    const ct = mapAppointmentWire({ ...LIVE_ROW, consultType: raw }).consultType;
    assert.ok(['video', 'audio', 'chat'].includes(ct), `${String(raw)} → ${ct}`);
  }
  assert.equal(mapAppointmentWire({ ...LIVE_ROW, consultType: 'audio' }).consultType, 'audio');
});

test('the server\'s `booked` is the UI\'s `upcoming`, as on the patient plane', () => {
  assert.equal(mapAppointmentWire({ ...LIVE_ROW, status: 'booked' }).status, 'upcoming');
  assert.equal(mapAppointmentWire({ ...LIVE_ROW, status: 'confirmed' }).status, 'confirmed');
});

test('a row with no ref derives the reference from the id', () => {
  assert.equal(mapAppointmentWire({ ...LIVE_ROW, ref: null }).ref, referenceFor(APPT_ID));
});

test('a row whose patient object is absent still gives the card an object', () => {
  // Appointment.Patient is `json.RawMessage` with omitempty: a booking whose
  // profile vanished answers no patient key at all, and
  // `appointment.patient.name` is read unguarded.
  const wire = { ...LIVE_ROW, patient: undefined };
  const a = mapAppointmentWire(wire);
  assert.equal(a.patient.name, '');
  assert.ok(a.patient.initials.length > 0);
  assert.equal(a.patient.id, '');
});

test('age and gender normalise instead of leaking null through a typed field', () => {
  assert.deepEqual(
    mapAppointmentWire({ ...LIVE_ROW, patient: { id: PATIENT_ID, name: 'Fatima Bello', age: 28, gender: 'Female' } }).patient,
    { id: PATIENT_ID, name: 'Fatima Bello', age: 28, gender: 'female', initials: 'FB', avatarColor: avatarColorFor(PATIENT_ID) },
  );
  const unknown = mapAppointmentWire({ ...LIVE_ROW, patient: { id: PATIENT_ID, name: 'Chidi Okeke' } }).patient;
  assert.equal(unknown.age, 0);
  assert.equal(unknown.gender, 'other');
});

test('the money and the reason come off the row unchanged', () => {
  const a = mapAppointmentWire(LIVE_ROW);
  assert.equal(a.feeKobo, 200000);
  assert.equal(a.reason, 'Recurring abdominal pain');
  assert.equal(a.isHmo, false);
});

// The requests inbox is the only screen with accept/decline controls
// (appointments/[id].tsx has none), so its wire must arrive complete too:
// r.appointment.* for the card, r.priority for the badge, r.status for the
// filter that keeps the row on screen at all.

const LIVE_REQUEST = {
  id: 'req-1',
  appointmentId: APPT_ID,
  status: 'pending',
  priority: 'normal',
  billing: 'paid',
  requestedAt: '2026-11-13T09:12:00Z',
  patientNote: 'Recurring abdominal pain',
  appointment: LIVE_ROW,
};

test('a request carries a nested appointment the inbox can render', () => {
  const r = mapRequestWire(LIVE_REQUEST);
  assert.equal(r.id, 'req-1');
  assert.equal(r.status, 'pending');
  assert.equal(r.appointment.id, APPT_ID);
  assert.equal(r.appointment.patient.initials, 'CO');
  assert.equal(r.patientNote, 'Recurring abdominal pain');
});

test('a request with no triage or billing on the row still has both', () => {
  // appointments has no priority or billing column — the booking escrowed a
  // real payment and the inbox reads QUEUE_PRIORITY_LABELS[r.priority], so the
  // defaults are 'paid' and 'normal', never undefined.
  const r = mapRequestWire({ ...LIVE_REQUEST, priority: undefined, billing: undefined });
  assert.equal(r.priority, 'normal');
  assert.equal(r.billing, 'paid');
});
