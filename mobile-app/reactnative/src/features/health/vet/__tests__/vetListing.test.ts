import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDistance, mapListedVet, type ListedVetWire } from '../vetListing.ts';

const wire: ListedVetWire = {
  id: 'a1b2',
  name: 'Dr. Amaka Obi',
  bio: 'Small-animal vet.',
  credential: { authority: 'VCN', status: 'verified' },
  clinicName: 'Lagoon Medical Centre',
  address: '12 Admiralty Way, Lekki, Lagos',
  distanceM: 2400,
  lat: 6.43,
  lng: 3.4,
  consultFeeKobo: 300000,
  homeVisitFeeKobo: 800000,
  types: ['tele', 'home'],
  species: ['dog'],
  specialties: ['Dermatology'],
  rating: 0,
  reviewCount: 0,
  availableNow: false,
  active: true,
};

test('formatDistance reads metres under a kilometre and kilometres above', () => {
  assert.equal(formatDistance(350), '350 m');
  assert.equal(formatDistance(2400), "2.4 km");
  assert.equal(formatDistance(undefined), '');
  assert.equal(formatDistance(Number.NaN), '');
});

test('mapListedVet produces the app Vet, carrying every public field', () => {
  const v = mapListedVet(wire);
  assert.equal(v.name, 'Dr. Amaka Obi');
  assert.equal(v.clinicName, 'Lagoon Medical Centre');
  assert.equal(v.distanceLabel, '2.4 km');
  assert.equal(v.consultFeeKobo, 300000);
  assert.equal(v.homeVisitFeeKobo, 800000);
  assert.deepEqual(v.types, ['tele', 'home']);
  assert.deepEqual(v.specialties, ['Dermatology']);
  assert.equal(v.credential.status, 'verified');
});

test('mapListedVet never invents a licence number', () => {
  assert.equal(mapListedVet(wire).credential.licenseNo, '');
});

test('mapListedVet fills missing fields with safe defaults', () => {
  const v = mapListedVet({ id: 'x', name: 'Dr. X', credential: { authority: 'VCN', status: 'verified' } });
  assert.equal(v.headline, '');
  assert.equal(v.distanceLabel, '');
  assert.deepEqual(v.types, []);
  assert.equal(v.active, true);
});
