import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OTHER_BREED,
  breedOptions,
  breedChoiceFor,
  breedFromChoice,
  localIsoDate,
  isAfterDate,
  toWirePet,
  petErrorMessage,
} from '../petForm.ts';

test('every species offers a breed list ending in Other', () => {
  for (const s of ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'other'] as const) {
    const opts = breedOptions(s);
    assert.equal(opts[opts.length - 1], OTHER_BREED, s);
    assert.ok(opts.length >= 2, s);
    assert.equal(new Set(opts).size, opts.length, `${s} has duplicate options`);
  }
});

test('a listed breed round-trips with no typed text', () => {
  const picked = breedChoiceFor('dog', 'Boerboel');
  assert.deepEqual(picked, { choice: 'Boerboel', typed: '' });
  assert.equal(breedFromChoice(picked.choice, picked.typed), 'Boerboel');
});

test('Other saves the typed breed, not the word "Other"', () => {
  assert.equal(breedFromChoice(OTHER_BREED, '  Kangal  '), 'Kangal');
  assert.deepEqual(breedChoiceFor('dog', 'Kangal'), { choice: OTHER_BREED, typed: 'Kangal' });
});

test('an empty breed opens with nothing picked', () => {
  assert.deepEqual(breedChoiceFor('cat', '  '), { choice: '', typed: '' });
});

test('localIsoDate uses the local calendar day, zero-padded', () => {
  assert.equal(localIsoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localIsoDate(new Date(2026, 9, 12, 0, 30)), '2026-10-12');
});

test('isAfterDate compares calendar dates', () => {
  assert.equal(isAfterDate('2026-10-13', '2026-10-12'), true);
  assert.equal(isAfterDate('2026-10-12', '2026-10-12'), false);
  assert.equal(isAfterDate('2025-12-31', '2026-01-01'), false);
});

test('toWirePet sends the names and codes the server stores', () => {
  const body = toWirePet({
    name: '  Bella ',
    species: 'dog',
    breed: 'Boerboel',
    sex: 'female',
    dob: '2021-06-15',
    weightKg: 48,
    notes: '  calm  ',
    microchipId: 'ignored-not-on-the-server',
  } as never);
  assert.deepEqual(body, {
    name: 'Bella',
    species: 'DOG',
    breed: 'Boerboel',
    sex: 'FEMALE',
    birth_date: '2021-06-15',
    weight_kg: 48,
    notes: 'calm',
  });
});

test('toWirePet omits what is not set rather than sending blanks', () => {
  const body = toWirePet({ name: 'Milo', species: 'cat', breed: 'Ragdoll', sex: 'unknown' });
  assert.equal(body.birth_date, undefined);
  assert.equal(body.weight_kg, undefined);
  assert.equal(body.notes, undefined);
  assert.equal(JSON.stringify(body).includes('birth_date'), false);
  assert.equal(body.sex, 'UNKNOWN');
});

test('petErrorMessage prefers the server message', () => {
  assert.equal(
    petErrorMessage({ response: { status: 422, data: { error: 'Date of birth cannot be in the future' } } }),
    'Date of birth cannot be in the future',
  );
});

test('petErrorMessage gives a status-specific reason when the server gave no message', () => {
  assert.equal(
    petErrorMessage({ response: { status: 500, data: {} } }),
    'The server could not save this pet (500). Try again.',
  );
});

test('petErrorMessage reports a network failure as no connection', () => {
  assert.equal(
    petErrorMessage(new Error('Network Error')),
    'No connection to the server. Check your internet and try again.',
  );
});
