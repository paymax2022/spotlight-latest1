// The wire→domain mapping for the vet PET and CONSULT reads — the screens
// reached from a pet's profile (app/(doctor)/vet/pet/[id]/*) and from a consult
// (app/(doctor)/vet/consult/[id]/*).
//
// Same bug class as the dashboard, proven the same way: `doctor.batch5.api.ts`
// and `doctor.phase3.api.ts` cast every live body straight into the screen's
// type (`doctorGet<VetChatThread>(...)`), while the Go projection is a different
// shape and answers 200. Because the call succeeded, each screen's
// `isLoading / isError / !data` guard passed and the first nested read threw.
//
// Two different backend situations, two different normalizations:
//   1. no backing table at all → the handler writes `json.RawMessage("{}")`
//      (service_vet.go GetPetChatThread / GetPetSoapNote / GetPetCallSession /
//      GetVetConsultSummary). There is nothing to map, so the honest answer is
//      "no data" — undefined — which is what these screens' guards and optional
//      chains already handle, exactly as getPetLabResult already returns
//      `PetLabResult | undefined`.
//   2. a real row with different keys → mapped from the columns Go actually
//      projects; what the row does not carry stays empty or zero.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyBodyHasNoData,
  mapPetProfileWire,
  mapPetGrowthWire,
  mapPetHealthRecordWire,
  mapPetVaccinationWire,
  mapPetVaccinationReminderWire,
  mapPetVaccinationRecommendationWire,
  mapIssuedPetPrescriptionWire,
} from '../vetWire.ts';

// ─── the `{}` no-table bodies ────────────────────────────────────────────────

test('an empty object from a no-table vet read means there is no data', () => {
  assert.equal(emptyBodyHasNoData({}), true);
  assert.equal(emptyBodyHasNoData(undefined), true);
  assert.equal(emptyBodyHasNoData(null), true);
});

test('a body that carries anything is data', () => {
  assert.equal(emptyBodyHasNoData({ petId: 'pet-1' }), false);
  assert.equal(emptyBodyHasNoData([{ id: 'pet-1' }]), false);
});

// ─── the pet row (doctor_pets) ───────────────────────────────────────────────

test('a pet row always has an owner object for the header to read', () => {
  // PetHeader reads pet.owner.name / pet.owner.avatarColor at pet/[id]/index.tsx:45-46.
  const pet = mapPetProfileWire({
    id: 'pet-1', name: 'Bingo', species: 'dog', breed: 'Boerboel', ownerRef: 'own-1',
  });

  assert.equal(pet.id, 'pet-1');
  assert.equal(pet.name, 'Bingo');
  assert.equal(pet.species, 'dog');
  assert.equal(pet.breed, 'Boerboel');
  assert.equal(pet.owner.id, 'own-1');
  assert.equal(typeof pet.owner.name, 'string');
  assert.equal(typeof pet.owner.avatarColor, 'string');
});

test('a pet row with nothing filled in still renders', () => {
  const pet = mapPetProfileWire({ id: 'pet-2' });

  assert.equal(pet.species, 'other');       // PET_SPECIES_LABELS[pet.species] must index
  assert.equal(pet.sex, 'unknown');
  assert.equal(pet.neutered, false);
  assert.equal(pet.ageMonths, 0);           // Math.floor(pet.ageMonths / 12) at index.tsx:44
  assert.equal(pet.weightKg, 0);
  assert.deepEqual(pet.allergies, []);
  assert.deepEqual(pet.chronicConditions, []);
  assert.deepEqual(pet.currentMedications, []);
  assert.deepEqual(pet.symptoms, []);
  assert.deepEqual(pet.vaccinations, []);
  assert.deepEqual(pet.history, []);
  assert.deepEqual(pet.images, []);
});

test('a species the union does not know is not typed as a known one', () => {
  assert.equal(mapPetProfileWire({ species: 'parrot' }).species, 'other');
});

test('growth points come from the jsonb the pet row carries', () => {
  // growth.tsx:59 reads history.points.length — the wire key is growthHistory.
  const history = mapPetGrowthWire({
    petId: 'pet-1',
    growthHistory: [{ date: '2026-01-05', weightKg: 12.5, ageMonths: 14 }],
  });

  assert.equal(history.petId, 'pet-1');
  assert.equal(history.points.length, 1);
  assert.equal(history.points[0].weightKg, 12.5);
});

test('a pet with no growth jsonb gets an empty trend, not undefined', () => {
  const history = mapPetGrowthWire({ petId: 'pet-1' });
  assert.deepEqual(history.points, []);
});

test('growth jsonb that is not an array cannot crash the trend', () => {
  // RecordPetGrowth appends whatever body the caller posted, so the column can
  // hold an object or a string; only a real list of points is a trend.
  assert.deepEqual(mapPetGrowthWire({ growthHistory: { weightKg: 12 } }).points, []);
  assert.deepEqual(mapPetGrowthWire({ growthHistory: 'oops' }).points, []);
});

// ─── the health record composite ─────────────────────────────────────────────

test('a health record always has a pet and always has its arrays', () => {
  // health-record.tsx:45 record.pet.owner.name, :52-53 the two counts, :63 chronic.
  const record = mapPetHealthRecordWire({ pet: null, vaccinations: null });

  assert.equal(typeof record.pet.id, 'string');
  assert.equal(typeof record.pet.owner.name, 'string');
  assert.deepEqual(record.vaccinations, []);
  assert.deepEqual(record.labResults, []);
  assert.deepEqual(record.consults, []);
  assert.deepEqual(record.chronicConditions, []);
});

test('lab orders are not lab results, so the results count stays honest', () => {
  // GetPetHealthRecord composites labOrders (doctor_pet_lab_orders); a result
  // only exists through GET /vet/lab-orders/{id}/result.
  const record = mapPetHealthRecordWire({ pet: { id: 'pet-1' }, labOrders: [{ id: 'lo-1' }] });
  assert.deepEqual(record.labResults, []);
});

test('a vaccination row is renamed into the fields the plan renders', () => {
  const vaccination = mapPetVaccinationWire({
    id: 'vac-1', vaccine: 'Rabies', administeredAt: '2026-01-05T00:00:00Z', dueAt: '2027-01-05T00:00:00Z',
  });

  assert.equal(vaccination.name, 'Rabies');
  assert.equal(vaccination.givenAt, '2026-01-05T00:00:00Z');
  assert.equal(vaccination.dueAt, '2027-01-05T00:00:00Z');
  assert.equal(vaccination.status, 'up_to_date');
});

test('a dose that is not overdue is still due', () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  assert.equal(mapPetVaccinationWire({ id: 'v', vaccine: 'DHPP', dueAt: future }).status, 'due');
});

test('a dose past its due date is overdue', () => {
  const past = new Date(Date.now() - 30 * 86400000).toISOString();
  const vaccination = mapPetVaccinationWire({ id: 'v', vaccine: 'Lepto', administeredAt: past, dueAt: past });
  assert.equal(vaccination.status, 'overdue');
});

test('a reminder row always carries a channel the label can upper-case', () => {
  // vaccinations.tsx:75 rm.channel.toUpperCase() — doctor_pet_vaccinations has
  // no channel or remindAt column at all.
  const reminder = mapPetVaccinationReminderWire({
    id: 'vac-1', petId: 'pet-1', vaccine: 'Rabies', dueAt: '2027-01-05T00:00:00Z', reminderSet: true,
  });

  assert.equal(reminder.vaccineName, 'Rabies');
  assert.equal(reminder.remindAt, '2027-01-05T00:00:00Z');
  assert.equal(reminder.enabled, true);
  assert.equal(typeof reminder.channel.toUpperCase, 'function');
  assert.ok(['sms', 'email', 'push'].includes(reminder.channel));
});

// ─── the vaccination recommendation row ──────────────────────────────────────

test('a recommendation carries an urgency the badge lookup can resolve', () => {
  // vaccinations.tsx:62 → PetVaccinationRow.tsx:35 → StatusBadge TONE[tone]:
  // an undefined `urgency` makes URGENCY_TONE[...] undefined and `c.bg` throws.
  // ListPetVaccinationRecommendations answers doctor_pet_vaccinations rows,
  // which have no urgency, rationale or species column.
  const past = new Date(Date.now() - 5 * 86400000).toISOString();
  const future = new Date(Date.now() + 5 * 86400000).toISOString();

  assert.deepEqual(
    mapPetVaccinationRecommendationWire({ id: 'vac-1', petId: 'pet-1', vaccine: 'Rabies', dueAt: past, reminderSet: false }),
    { id: 'vac-1', petId: 'pet-1', vaccineName: 'Rabies', forSpecies: [], urgency: 'overdue', dueDate: past, rationale: '' },
  );
  assert.equal(mapPetVaccinationRecommendationWire({ id: 'v', dueAt: future }).urgency, 'due_soon');
  assert.equal(mapPetVaccinationRecommendationWire({ id: 'v', dueAt: future, administeredAt: '2026-01-05T00:00:00Z' }).urgency, 'routine');
  assert.equal(mapPetVaccinationRecommendationWire({ id: 'v' }).urgency, 'routine');
});

// ─── the issued prescription wrapper ─────────────────────────────────────────

test('an issued prescription keeps the wrapper the screen renders through', () => {
  // issue.tsx:67 issued.prescription.ref — GetIssuedPetPrescription answers a
  // FLAT doctor_pet_prescriptions row, not the {prescription, audit} wrapper.
  const issued = mapIssuedPetPrescriptionWire({
    id: 'rx-1', ref: 'PRX-4F2A41', petId: 'pet-1', status: 'issued',
    items: [{ drugId: 'd-1', name: 'Amoxicillin' }],
  });

  assert.equal(issued.prescription.id, 'rx-1');
  assert.equal(issued.prescription.ref, 'PRX-4F2A41');
  assert.equal(issued.prescription.petId, 'pet-1');
  assert.equal(issued.prescription.items.length, 1);
  assert.deepEqual(issued.prescription.warnings, []);
  assert.deepEqual(issued.audit, []);
  assert.ok(['not_sent', 'sending', 'sent', 'received', 'dispensed', 'failed'].includes(issued.sendStatus));
});

test('a prescription row with no columns filled in still has its scalars', () => {
  const issued = mapIssuedPetPrescriptionWire({ id: 'rx-2' });

  assert.equal(issued.prescription.ref, '');
  assert.equal(issued.prescription.petId, '');
  assert.equal(issued.prescription.status, 'draft');
  assert.deepEqual(issued.prescription.items, []);
});
