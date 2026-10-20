// Pure-logic unit tests for the live telemedicine payload mapping.
// The bug these guard: the patient screens were written against the demo Doctor/
// Appointment fixtures, while backend/internal/telemedicine answers snake_case rows
// with ONE `specialty` slug, no initials, no avatar colour and status `booked`.
// `mapDoctorMoney` carried only the money half, so the first live doctor crashed the
// list on `doctor.specialties.join` — an undefined read, not an empty one.
//
// Fixtures are the LITERAL JSON emitted by the Go models (model.go Doctor/Specialty/
// Appointment, service_block13.go Review), so these fail if client and server drift
// apart again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  avatarColorFor,
  initialsFromName,
  mapLiveAppointment,
  mapLiveBookingResult,
  mapLiveDoctor,
  mapLiveReview,
  mapLiveSpecialty,
  referenceFor,
  specialtyLabel,
} from '@/features/telemedicine/mapping';

/** telemedicine.Doctor as the handler writes it (handler.go ListDoctors → {"data":[…]}). */
const SERVER_DOCTOR = {
  id:              'c529dce4-3254-48f4-a8f0-ae42a50d99bc',
  user_id:         'e2ccf07b-cebd-4c32-95d8-3caa8ae3dae4',
  name:            'Dr. Amaka Obi',
  specialty:       'general',
  bio:             'Family physician.',
  consult_fee_kobo: 350_000,
  booking: {
    consult_fee_kobo:  350_000,
    platform_fee_bp:   500,
    platform_fee_kobo: 17_500,
    total_kobo:        367_500,
  },
  is_available:    true,
  is_online:       false,
  is_hmo_verified: false,
  experience_years: 12,
  rating:          4.9,
  review_count:    312,
  patients_count:  90,
  success_rate:    98,
  is_featured:     true,
  education:       [{ institution: 'UNN', degree: 'MBBS', year: 2011 }],
  created_at:      '2026-01-05T08:00:00Z',
};

describe('mapLiveDoctor', () => {
  const d = mapLiveDoctor(SERVER_DOCTOR);

  it('renders a display label list for the single server slug', () => {
    assert.ok(Array.isArray(d.specialties));
    assert.deepEqual(d.specialties, ['General']);
  });

  it('derives avatar initials without the honorific', () => {
    assert.equal(d.initials, 'AO');
    assert.equal(avatarColorFor(d.id), avatarColorFor(SERVER_DOCTOR.id));
  });

  it('keeps the money contract from pricing.ts intact', () => {
    assert.equal(d.feeKobo, 350_000);
    assert.deepEqual(d.booking, {
      consultFeeKobo:  350_000,
      platformFeeBp:   500,
      platformFeeKobo: 17_500,
      totalKobo:       367_500,
    });
  });

  it('maps the snake_case profile fields the stats row reads', () => {
    assert.equal(d.rating, 4.9);
    assert.equal(d.reviewCount, 312);
    assert.equal(d.yearsExperience, 12);
    assert.equal(d.specialtyId, 'general');
    assert.equal(d.featured, true);
    assert.equal(d.title, 'MBBS');
    assert.equal(d.bio, 'Family physician.');
  });

  it('reports an empty language list rather than inventing one', () => {
    // No `languages` column on doctors yet; the card counts them, so a guessed
    // list would be a claim about a doctor the server never made.
    assert.deepEqual(d.languages, []);
  });

  it('says what availability the server actually states', () => {
    assert.equal(d.nextAvailable, 'Accepting bookings');
    assert.equal(mapLiveDoctor({ ...SERVER_DOCTOR, is_online: true }).nextAvailable, 'Online now');
    assert.equal(
      mapLiveDoctor({ ...SERVER_DOCTOR, is_available: false }).nextAvailable,
      'Not accepting bookings',
    );
  });

  it('appends a sub-specialty when the server sends one', () => {
    const d2 = mapLiveDoctor({ ...SERVER_DOCTOR, specialty: 'mental_health', sub_specialty: 'Anxiety' });
    assert.deepEqual(d2.specialties, ['Mental Health', 'Anxiety']);
  });

  it('survives the nullable columns the row really has', () => {
    // bio/about/sub_specialty/avatar_url/mdcn_number are NULLABLE; the list route
    // must render a doctor that has said nothing about itself.
    const bare = mapLiveDoctor({ id: 'x', name: 'Dr Fee Test', specialty: 'general', consult_fee_kobo: 99_991 });
    assert.deepEqual(bare.specialties, ['General']);
    assert.equal(bare.bio, '');
    assert.equal(bare.title, '');
    assert.equal(bare.rating, 0);
    assert.equal(bare.booking, undefined);
  });
});

describe('initialsFromName', () => {
  it('strips titles and takes the first and last words', () => {
    assert.equal(initialsFromName('Dr. Amaka Obi'), 'AO');
    assert.equal(initialsFromName('Dr Ngozi Eze'), 'NE');
    assert.equal(initialsFromName('Prof. Ibrahim Musa Sarki'), 'IS');
    assert.equal(initialsFromName('Ada'), 'A');
    assert.equal(initialsFromName(''), 'Dr');
  });
});

describe('specialtyLabel', () => {
  it('humanises the stored slug', () => {
    assert.equal(specialtyLabel('womens_health'), "Womens Health");
    assert.equal(specialtyLabel('eye_care'), 'Eye Care');
    assert.equal(specialtyLabel(''), '');
  });
});

describe('mapLiveSpecialty', () => {
  // telemedicine.Specialty: id is a UUID, slug is what doctors.specialty stores.
  const SERVER_SPECIALTY = {
    id:          '7f0f2b04-4f4f-4a11-9e1f-0d6b1a2b3c4d',
    slug:        'paediatrics',
    name:        'Pediatrics',
    description: 'Expert child care',
    icon:        'happy-outline',
    doctor_count: 14,
    is_featured: true,
  };

  it('keys the chip by slug so the server filter matches', () => {
    // Go compares `specialty_id` against doctors.specialty (the slug); keying by
    // the UUID returned every filtered list empty.
    assert.equal(mapLiveSpecialty(SERVER_SPECIALTY).id, 'paediatrics');
  });

  it('swaps the stored ionicon name for one lucide actually has', () => {
    assert.equal(mapLiveSpecialty(SERVER_SPECIALTY).icon, 'Baby');
    assert.equal(mapLiveSpecialty({ ...SERVER_SPECIALTY, slug: 'nope' }).icon, 'Stethoscope');
  });

  it('carries the count and gives the tile a tint', () => {
    const s = mapLiveSpecialty(SERVER_SPECIALTY);
    assert.equal(s.doctorCount, 14);
    assert.equal(s.name, 'Pediatrics');
    assert.match(s.accent, /^#[0-9A-Fa-f]{3,8}$/);
    assert.ok(s.bg.length > 0);
  });
});

describe('mapLiveAppointment', () => {
  /** Local-time ISO (no trailing Z) so the slot assertions hold in any TZ. */
  const SERVER_APPOINTMENT = {
    id:                '96dd5b0c-0484-49b8-a09d-af4159f1f33e',
    patient_id:        'e2ccf07b-cebd-4c32-95d8-3caa8ae3dae4',
    doctor_id:         'c529dce4-3254-48f4-a8f0-ae42a50d99bc',
    doctor_name:       'Dr. Amaka Obi',
    doctor_specialty:  'general',
    consultation_type: 'video',
    scheduled_at:      '2026-09-20T10:00:00',
    status:            'booked',
    notes:             'Persistent headache',
    fee_kobo:          350_000,
    platform_fee_kobo: 17_500,
    total_kobo:        367_500,
    idempotency_key:   'abc',
    settlement_id:     '',
    created_at:        '2026-09-18T09:00:00Z',
  };
  const a = mapLiveAppointment(SERVER_APPOINTMENT);

  it('translates the server status into the UI lifecycle', () => {
    // The list tabs filter on `upcoming`; `booked` would have vanished from both.
    assert.equal(a.status, 'upcoming');
    assert.equal(mapLiveAppointment({ ...SERVER_APPOINTMENT, status: 'completed' }).status, 'completed');
  });

  it('splits scheduled_at into the slot pair the cards render', () => {
    assert.equal(a.slotDate, '2026-09-20');
    assert.equal(a.slotTime, '10:00 AM');
  });

  it('builds the doctor summary the row avatar needs', () => {
    assert.equal(a.doctor.id, SERVER_APPOINTMENT.doctor_id);
    assert.equal(a.doctor.name, 'Dr. Amaka Obi');
    assert.equal(a.doctor.initials, 'AO');
    assert.deepEqual(a.doctor.specialties, ['General']);
  });

  it('keeps the money mapping and derives the reference from the id', () => {
    assert.equal(a.feeKobo, 350_000);
    assert.equal(a.totalKobo, 367_500);
    assert.equal(a.ref, referenceFor(a.id));
    assert.equal(a.ref, 'TM-96DD5B');
  });

  it('reads notes as the reason and passes an unknown consult type safely', () => {
    assert.equal(a.reason, 'Persistent headache');
    assert.equal(mapLiveAppointment({ ...SERVER_APPOINTMENT, consultation_type: 'audio' }).consultType, 'audio');
    assert.equal(mapLiveAppointment({ ...SERVER_APPOINTMENT, consultation_type: 'smell' }).consultType, 'video');
  });

  it('leaves the slot blank for an unparseable scheduled_at', () => {
    const broken = mapLiveAppointment({ ...SERVER_APPOINTMENT, scheduled_at: '' });
    assert.equal(broken.slotDate, '');
    assert.equal(broken.slotTime, '');
  });
});

describe('mapLiveBookingResult', () => {
  it('reads the created appointment row the handler returns', () => {
    // POST /api/v1/telemedicine/appointments answers {"data": <Appointment>}, not
    // {appointmentId, ref} — unmapped, the success screen carried undefined.
    const r = mapLiveBookingResult({ id: '96dd5b0c-0484-49b8-a09d-af4159f1f33e', status: 'booked' });
    assert.equal(r.appointmentId, '96dd5b0c-0484-49b8-a09d-af4159f1f33e');
    assert.equal(r.ref, 'TM-96DD5B');
    assert.equal(r.status, 'upcoming');
  });
});

describe('mapLiveReview', () => {
  it('maps the review row from service_block13.go', () => {
    const rev = mapLiveReview({
      id:             'r-1',
      appointment_id: '96dd5b0c-0484-49b8-a09d-af4159f1f33e',
      doctor_id:      'c529dce4',
      patient_id:     'e2ccf07b',
      rating:         5,
      comment:        'Thorough.',
      is_hidden:      false,
      created_at:     '2026-09-21T09:00:00Z',
    });
    assert.equal(rev.appointmentId, '96dd5b0c-0484-49b8-a09d-af4159f1f33e');
    assert.equal(rev.rating, 5);
    assert.equal(rev.comment, 'Thorough.');
    assert.equal(rev.createdAt, '2026-09-21T09:00:00Z');
  });
});
