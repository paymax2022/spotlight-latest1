// Nested (child_data) schema behaviour.
//
// MyCover nests shapes under `child_data`, and publishes `policy_holder` as
// required:false with several required:true children on 64 of its 68 products.
// Two rules follow, and both are load-bearing:
//
//   1. An optional block nobody has begun is valid as a whole. Validating its
//      children unconditionally blocks the form on a section the insurer itself
//      marks optional.
//   2. Once any child is answered the block is all-or-nothing, because a
//      half-filled policy holder sends the insurer a partial identity.
//
// Shapes here mirror the live gadget product's schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateField, validateAll, buildInputs } from '../live/formEngine.ts';
import type { Field } from '../live/types.ts';

const policyHolder: Field = {
  name: 'policy_holder',
  label: 'Policy holder',
  type: 'object',
  required: false,
  children: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'gender', label: 'Gender', type: 'select', required: true, options: [
      { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' },
    ] },
    { name: 'address', label: 'Address', type: 'address', required: true },
  ] as Field[],
};

const contents: Field = {
  name: 'general_contents',
  label: 'General contents',
  type: 'array',
  required: false,
  children: [
    { name: 'item', label: 'Item', type: 'text', required: true },
    { name: 'value', label: 'Value', type: 'money', required: true },
  ] as Field[],
};

test('an untouched optional object is valid despite required children', () => {
  assert.equal(validateField(policyHolder, undefined), null);
  assert.equal(validateField(policyHolder, {} as never), null);
  // A group whose keys exist but are all blank has still not been started.
  assert.equal(validateField(policyHolder, { email: '', gender: '', address: '' } as never), null);
});

test('a started optional object becomes all-or-nothing', () => {
  const err = validateField(policyHolder, { email: 'a@b.com' } as never);
  assert.ok(err, 'expected the untouched required children to be reported');
  assert.match(String(err), /required|Choose/i);
});

test('a fully answered optional object passes', () => {
  assert.equal(
    validateField(policyHolder, {
      email: 'a@b.com',
      gender: 'Male',
      address: '12 Test Road, Lagos',
    } as never),
    null,
  );
});

test('a REQUIRED object still demands its contents', () => {
  const required: Field = { ...policyHolder, required: true };
  assert.ok(validateField(required, undefined), 'a required block cannot be skipped');
});

test('an untouched optional object is omitted from the payload, not sent as {}', () => {
  const out = buildInputs([policyHolder], { policy_holder: {} } as never);
  assert.equal('policy_holder' in out, false);

  const blank = buildInputs([policyHolder], {
    policy_holder: { email: '', gender: '', address: '' },
  } as never);
  assert.equal('policy_holder' in blank, false);
});

test('an answered object is nested under its own name', () => {
  const out = buildInputs([policyHolder], {
    policy_holder: { email: 'a@b.com', gender: 'Male', address: '12 Test Road' },
  } as never) as Record<string, any>;
  assert.deepEqual(out.policy_holder, {
    email: 'a@b.com',
    gender: 'Male',
    address: '12 Test Road',
  });
});

test('empty array rows are dropped and an empty array is omitted', () => {
  const out = buildInputs([contents], { general_contents: [{}, { item: '', value: '' }] } as never);
  assert.equal('general_contents' in out, false);
});

test('array rows that were filled survive, in order', () => {
  const out = buildInputs([contents], {
    general_contents: [
      { item: 'Sofa', value: '150000' },
      {},
      { item: 'TV', value: '90000' },
    ],
  } as never) as Record<string, any>;
  assert.equal(out.general_contents.length, 2);
  assert.equal(out.general_contents[0].item, 'Sofa');
  assert.equal(out.general_contents[1].item, 'TV');
  // money children still cross as integer kobo
  assert.equal(typeof out.general_contents[0].value, 'number');
});

test('an optional block does not block a whole-form validation pass', () => {
  const fields: Field[] = [
    { name: 'first_name', label: 'First name', type: 'text', required: true } as Field,
    policyHolder,
  ];
  const errors = validateAll(fields, { first_name: 'Ada' } as never);
  assert.equal(Object.keys(errors).length, 0, JSON.stringify(errors));
});
