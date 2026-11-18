// Timed consult packages on the telemedicine booking path (Slice 2, Task 11).
// `GET /doctors/:id` now carries `packages`, each with its own server quote; the
// booking screens must sell and price those price points without ever computing a
// platform fee of their own (ADR-044).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapLiveDoctor } from '@/features/telemedicine/mapping';
import { offerFromDoctorPackage } from '@/features/consult/types';

test('mapLiveDoctor carries the doctor package list through unchanged', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-1',
    name: 'Dr Amaka Obi',
    specialty: 'general',
    consult_fee_kobo: 500_000,
    packages: [
      {
        id: 'pkg-1',
        mode: 'video',
        duration_minutes: 30,
        price_kobo: 700_000,
        booking: {
          consult_fee_kobo: 700_000,
          platform_fee_bp: 500,
          platform_fee_kobo: 35_000,
          total_kobo: 735_000,
        },
      },
    ],
  });

  assert.equal(doctor.packages?.length, 1);
  assert.deepEqual(offerFromDoctorPackage(doctor.packages![0]), {
    id: 'pkg-1',
    mode: 'video',
    durationMinutes: 30,
    priceKobo: 700_000,
    totalKobo: 735_000,
  });
});

test('a package the picker cannot interpret is dropped, never guessed', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-2',
    name: 'Dr Tunde Bello',
    specialty: 'cardiology',
    packages: [{ id: 'pkg-2', mode: 'telepathy', duration_minutes: 30, price_kobo: 100_000 }],
  });

  const offers = (doctor.packages ?? []).map(offerFromDoctorPackage).filter(Boolean);
  assert.deepEqual(offers, []);
});

test('a package without a server quote totals its package price and speaks voice', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-3',
    name: 'Dr Ngozi Eze',
    specialty: 'dermatology',
    packages: [{ id: 'pkg-3', mode: 'audio', duration_minutes: 20, price_kobo: 300_000 }],
  });

  const offer = offerFromDoctorPackage(doctor.packages![0]);
  assert.equal(offer?.mode, 'voice');
  assert.equal(offer?.priceKobo, 300_000);
  assert.equal(offer?.totalKobo, 300_000);
});
