// "Add another medication" appended a blank row, but serializeMeds() stripped
// any row with no name/dose before the value ever reached onChange — so the
// next render reconstructed the exact same rows and the button looked inert.
// These tests pin the fix at the two places it touches: the field's own
// serialize step (no blank-row stripping) and validateStep's required-field
// gate (still treats an all-blank med_list as empty, via isEmpty()).

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStep, formatMedList } from '@/features/health/utils';
import { parseMeds, serializeMeds } from '@/features/health/medListCodec';
import type { IntakeStep, IntakeResponseValues } from '@/features/health/types';

function medListStep(required: boolean): IntakeStep {
  return {
    id: 'meds-step',
    title: 'Medications',
    fields: [
      { id: 'medications_list', type: 'med_list', label: 'Current medications', required },
    ],
  };
}

test('clicking "Add another medication" survives the onChange round-trip', () => {
  // Mirrors IntakeField's add(): rows = parseMeds(value); onChange(serializeMeds([...rows, blank])).
  const value = serializeMeds([{ name: 'Amlodipine', dose: '5mg' }]);
  const afterAdd = serializeMeds([...parseMeds(value), { name: '', dose: '' }]);
  const rowsAfterAdd = parseMeds(afterAdd);
  assert.equal(rowsAfterAdd.length, 2, 'the blank row the user just added must survive the round-trip');
  assert.deepEqual(rowsAfterAdd[1], { name: '', dose: '' });
});

test('clicking "Add another medication" on an empty field still shows a second row', () => {
  // The reported repro: no medication typed yet, user clicks "add another".
  const rowsBeforeAdd = parseMeds('').length ? parseMeds('') : [{ name: '', dose: '' }];
  const afterAdd = serializeMeds([...rowsBeforeAdd, { name: '', dose: '' }]);
  assert.equal(parseMeds(afterAdd).length, 2);
});

test('required med_list with only blank rows still fails validation', () => {
  const values: IntakeResponseValues = {
    medications_list: JSON.stringify([{ name: '', dose: '' }, { name: '', dose: '' }]),
  };
  const errors = validateStep(medListStep(true), values);
  assert.ok(errors.medications_list, 'an all-blank med list must still count as empty');
});

test('required med_list with one filled row passes validation', () => {
  const values: IntakeResponseValues = {
    medications_list: JSON.stringify([{ name: 'Amlodipine', dose: '5mg' }, { name: '', dose: '' }]),
  };
  const errors = validateStep(medListStep(true), values);
  assert.equal(errors.medications_list, undefined);
});

test('formatMedList ignores blank rows for display', () => {
  const value = JSON.stringify([{ name: 'Amlodipine', dose: '5mg' }, { name: '', dose: '' }]);
  assert.deepEqual(formatMedList(value), ['Amlodipine — 5mg']);
});
