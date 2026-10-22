// The med/allergy/condition questions pair a boolean gate with the detail it
// unlocks. The detail used to render and keep its value regardless of the gate,
// so a patient who answered "No ongoing conditions" after tapping a chip arrived
// at the doctor with "No" printed above "Asthma, Hypertension".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGateAnswer, reconcileGates, stepFields, gatedDetailFields, isGatedOff, validateStep,
} from '@/features/health/utils';
import type { IntakeStep, IntakeResponseValues } from '@/features/health/types';

const chronicStep: IntakeStep = {
  id: 'chronic',
  title: 'Chronic conditions',
  fields: [
    { id: 'conditions_none', type: 'boolean', label: 'Do you have any ongoing / chronic conditions?', required: true },
    { id: 'conditions_list', type: 'multi_select', label: 'Select your conditions' },
    { id: 'conditions_other', type: 'short_text', label: 'Other condition' },
  ],
};

test('gatedDetailFields knows which detail belongs to which gate', () => {
  assert.deepEqual(gatedDetailFields('conditions_none'), ['conditions_list', 'conditions_other']);
  assert.deepEqual(gatedDetailFields('meds_none'), ['medications_list']);
  assert.deepEqual(gatedDetailFields('chief_complaint'), []);
});

test('answering the gate "No" drops the detail it had unlocked', () => {
  const withList: IntakeResponseValues = { conditions_none: true, conditions_list: ['asthma'], conditions_other: 'Epilepsy' };
  const next = applyGateAnswer({ ...withList, conditions_none: false }, 'conditions_none');
  assert.equal(next.conditions_none, false);
  assert.equal('conditions_list' in next, false);
  assert.equal('conditions_other' in next, false);
});

test('answering the gate "Yes" keeps the detail', () => {
  const values: IntakeResponseValues = { conditions_none: true, conditions_list: ['asthma'] };
  assert.deepEqual(applyGateAnswer(values, 'conditions_none').conditions_list, ['asthma']);
});

test('a field that is not a gate clears nothing', () => {
  const stale: IntakeResponseValues = { conditions_none: false, conditions_list: ['asthma'] };
  assert.deepEqual(applyGateAnswer(stale, 'chief_complaint').conditions_list, ['asthma']);
});

test('a stored draft that contradicts its gate is reconciled on load', () => {
  const stale: IntakeResponseValues = {
    meds_none: false, medications_list: '[]',
    allergies_none: false, allergies_list: ['penicillin'], allergies_other: 'rash',
    conditions_none: false, conditions_list: ['asthma'],
    chief_complaint: 'Cough',
  };
  const clean = reconcileGates(stale);
  assert.deepEqual(Object.keys(clean).sort(), ['allergies_none', 'chief_complaint', 'conditions_none', 'meds_none']);
});

test('stepFields hides a detail its gate answered away', () => {
  const ids = stepFields(chronicStep, { conditions_none: false }).map((f) => f.id);
  assert.deepEqual(ids, ['conditions_none']);
});

test('stepFields keeps the detail while the gate is unanswered', () => {
  const ids = stepFields(chronicStep, {}).map((f) => f.id);
  assert.deepEqual(ids, ['conditions_none', 'conditions_list', 'conditions_other']);
});

test('isGatedOff is only true for an explicit "No"', () => {
  assert.equal(isGatedOff('conditions_list', { conditions_none: false }), true);
  assert.equal(isGatedOff('conditions_list', { conditions_none: true }), false);
  assert.equal(isGatedOff('conditions_list', {}), false);
  assert.equal(isGatedOff('chief_complaint', { conditions_none: false }), false);
});

test('the detail is required only while the gate says Yes', () => {
  assert.equal(
    validateStep(chronicStep, { conditions_none: true }).conditions_list,
    'Please add at least one, or change your answer above',
  );
  assert.equal(validateStep(chronicStep, { conditions_none: true, conditions_list: ['asthma'] }).conditions_list, undefined);
  assert.equal(validateStep(chronicStep, { conditions_none: false }).conditions_list, undefined);
});

test('the optional "other" free-text never blocks the wizard', () => {
  // A patient who picks "Penicillin" must not be forced to also describe it.
  const allergiesStep: IntakeStep = {
    id: 'allergies',
    title: 'Allergies',
    fields: [
      { id: 'allergies_none', type: 'boolean', label: 'Do you have any drug allergies?', required: true },
      { id: 'allergies_list', type: 'multi_select', label: 'Select your allergies' },
      { id: 'allergies_other', type: 'short_text', label: 'Other allergy / reaction details' },
    ],
  };
  const errors = validateStep(allergiesStep, { allergies_none: true, allergies_list: ['penicillin'] });
  assert.deepEqual(errors, {});
  // It still disappears with the list when the gate says No.
  assert.deepEqual(stepFields(allergiesStep, { allergies_none: false }).map((f) => f.id), ['allergies_none']);
});
