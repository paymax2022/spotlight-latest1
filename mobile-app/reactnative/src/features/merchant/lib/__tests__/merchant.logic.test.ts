// Pure-logic unit tests (form-schema validation + application state machine).
// Run with Node's native TS type-stripping:  node --test src/features/merchant/lib/__tests__/merchant.logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStep, isFieldVisible } from '../validation.ts';
import { canTransition, applyEvent, isTerminal } from '../applicationStateMachine.ts';
import type { FormStep } from '../../../../types/merchant.ts';

const step: FormStep = {
  key: 'practice', title: 'Practice',
  fields: [
    { key: 'years', type: 'number', label: 'Years', required: true, min: 0, max: 60 },
    { key: 'modes', type: 'multiselect', label: 'Modes', required: true, maxSelections: 2 },
    { key: 'email', type: 'email', label: 'Email', required: false },
    { key: 'has_clinic', type: 'boolean', label: 'Has clinic', required: false },
    { key: 'clinic_address', type: 'address', label: 'Clinic address', required: true,
      visibleWhen: { field: 'has_clinic', equals: true } },
  ],
};

// ── Validation ────────────────────────────────────────────────────────────────
test('required field missing fails', () => {
  const r = validateStep(step, { modes: ['video'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.years);
});

test('number out of range fails', () => {
  const r = validateStep(step, { years: 99, modes: ['video'] });
  assert.match(r.errors.years, /at most 60/);
});

test('multiselect over cap fails', () => {
  const r = validateStep(step, { years: 5, modes: ['video', 'chat', 'in_person'] });
  assert.match(r.errors.modes, /at most 2/);
});

test('invalid email fails, valid passes', () => {
  assert.ok(validateStep(step, { years: 5, modes: ['video'], email: 'nope' }).errors.email);
  assert.equal(validateStep(step, { years: 5, modes: ['video'], email: 'a@b.co' }).ok, true);
});

test('conditional field hidden -> not required; shown -> required', () => {
  // has_clinic false: clinic_address hidden, so a valid base passes
  assert.equal(isFieldVisible(step.fields[4], { has_clinic: false }), false);
  assert.equal(validateStep(step, { years: 5, modes: ['video'], has_clinic: false }).ok, true);
  // has_clinic true: clinic_address now required and missing -> fails
  assert.equal(isFieldVisible(step.fields[4], { has_clinic: true }), true);
  const r = validateStep(step, { years: 5, modes: ['video'], has_clinic: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.clinic_address);
});

// ── State machine (PRD §7.2) ──────────────────────────────────────────────────
test('legal happy path transitions', () => {
  assert.equal(applyEvent('DRAFT', 'submit'), 'SUBMITTED');
  assert.equal(applyEvent('SUBMITTED', 'pick_up'), 'UNDER_REVIEW');
  assert.equal(applyEvent('UNDER_REVIEW', 'approve'), 'APPROVED');
});

test('needs-info loop', () => {
  assert.equal(applyEvent('UNDER_REVIEW', 'request_info'), 'NEEDS_MORE_INFO');
  assert.equal(applyEvent('NEEDS_MORE_INFO', 'resubmit'), 'UNDER_REVIEW');
});

test('illegal transitions rejected', () => {
  assert.equal(canTransition('DRAFT', 'approve'), false);
  assert.equal(canTransition('SUBMITTED', 'approve'), false);   // must be picked up first
  assert.equal(canTransition('APPROVED', 'reject'), false);
  assert.throws(() => applyEvent('DRAFT', 'approve'), /Illegal transition/);
});

test('terminal states are terminal', () => {
  assert.equal(isTerminal('APPROVED'), true);
  assert.equal(isTerminal('REJECTED'), true);
  assert.equal(isTerminal('UNDER_REVIEW'), false);
});
