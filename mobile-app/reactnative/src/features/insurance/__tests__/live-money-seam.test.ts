// The KOBO/NAIRA SEAM between this app and the Go adapter.
//   node --experimental-strip-types --test src/features/insurance/__tests__/live-money-seam.test.ts
//
// MyCover's form inputs are denominated in NAIRA. This app carries every money
// value in INTEGER KOBO, because that is the internal contract. For a long time
// nothing converted between them: buildInputs sent kobo, the Go adapter copied
// the inputs verbatim into the provider body, and every declared value reached
// the insurer 100x too large.
//
// Proven live against product ffb0711c-1e4a-453b-a26c-2726e0a1a7bb (gadget
// cover, rated at 5% of the declared value):
//
//   body.value = 200000    (naira)  → premium NGN 10,000
//   body.value = 20000000  (kobo)   → premium NGN 1,000,000
//
// The fix converts ONCE, in the Go adapter, for exactly the fields the published
// schema labelled `money`. These tests pin this side of that seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { MONEY_WIRE_UNIT, boundInFieldUnits, buildInputs, validateField } from '../live/formEngine.ts';
import { mapFormSchema } from '../live/normalize.ts';
import type { Field } from '../live/types.ts';

const f = (over: Partial<Field> & { name: string }): Field => ({
  label: over.name,
  type: 'text',
  required: false,
  ...over,
});

// The `value` field of the live gadget schema, as the backend now publishes it:
// the provider's ₦100,000 minimum expressed in the contract's own unit.
const GADGET_VALUE: Field = f({
  name: 'value',
  label: 'Device value',
  type: 'money',
  required: true,
  min: 10_000_000, // ₦100,000 in kobo
  unit: 'kobo',
});

// ── The minimum must bite at its true magnitude ─────────────────────────────

test('a ₦100,000 money minimum rejects a ₦1,000 device', () => {
  // ₦1,000 is a hundredth of the minimum. Read against an UNSCALED bound of
  // 100000 it looks acceptable (100,000 kobo >= 100,000), which is the exact
  // shape of the leniency bug: the insurer would reject it after a round trip.
  assert.equal(
    validateField(GADGET_VALUE, '1000'),
    'Must be at least ₦100,000',
    'a ₦1,000 phone must fail a ₦100,000 minimum here, not at the insurer',
  );
});

test('the same minimum accepts a ₦200,000 device', () => {
  assert.equal(validateField(GADGET_VALUE, '200000'), null);
});

test('the minimum bites exactly at ₦100,000', () => {
  assert.equal(validateField(GADGET_VALUE, '99999'), 'Must be at least ₦100,000');
  assert.equal(validateField(GADGET_VALUE, '100000'), null);
});

test('an unlabelled money bound is read as kobo — the contract default', () => {
  const unlabelled = f({ ...GADGET_VALUE, unit: undefined });
  assert.equal(boundInFieldUnits(unlabelled, 10_000_000), 10_000_000);
  // Which is why the backend must publish the bound in kobo: a client that
  // ignores `unit` entirely still enforces ₦100,000.
  assert.equal(validateField(unlabelled, '1000'), 'Must be at least ₦100,000');
});

test('a bound explicitly stated in naira is still scaled', () => {
  const naira = f({ ...GADGET_VALUE, min: 100_000, unit: 'naira' });
  assert.equal(boundInFieldUnits(naira, 100_000), 10_000_000);
  assert.equal(validateField(naira, '1000'), 'Must be at least ₦100,000');
});

test('a normalised backend schema keeps the published unit and bound', () => {
  const schema = mapFormSchema({
    fields: [
      { name: 'value', label: 'Device value', type: 'money', required: true, min: 10000000, unit: 'kobo' },
      { name: 'payment_plan', label: 'Payment plan', type: 'number', min: 1, max: 12 },
    ],
  })!;
  const value = schema.fields.find((x) => x.name === 'value')!;
  assert.equal(value.type, 'money');
  assert.equal(value.unit, 'kobo');
  assert.equal(value.min, 10_000_000);
  assert.equal(validateField(value, '1000'), 'Must be at least ₦100,000');

  // A plan count is not money and must not be scaled by anything.
  const plan = schema.fields.find((x) => x.name === 'payment_plan')!;
  assert.equal(plan.unit, undefined);
  assert.equal(boundInFieldUnits(plan, plan.min), 1);
});

// ── What goes over the wire ─────────────────────────────────────────────────

test('buildInputs emits money in the unit the seam declares', () => {
  assert.equal(MONEY_WIRE_UNIT, 'kobo');

  const out = buildInputs([GADGET_VALUE, f({ name: 'device_make' })], {
    value: '200000',
    device_make: 'Samsung',
  });
  // ₦200,000 → 20,000,000 kobo. The Go adapter divides by 100 exactly once, so
  // the provider sees 200000 and prices it at ₦10,000.
  assert.equal(out.value, 20_000_000);
  assert.equal(typeof out.value, 'number');
  assert.ok(Number.isInteger(out.value as number), 'money on the wire is an integer of minor units');
  assert.equal(out.device_make, 'Samsung');
});

test('kobo precision survives the wire', () => {
  const out = buildInputs([GADGET_VALUE], { value: '200000.50' });
  assert.equal(out.value, 20_000_050);
});

test('a non-money numeric field is sent as typed', () => {
  const out = buildInputs([f({ name: 'payment_plan', type: 'number', min: 1, max: 12 })], {
    payment_plan: '12',
  });
  assert.equal(out.payment_plan, 12, 'an instalment count must never be scaled like money');
});

test('nested and repeating money answers are kobo too', () => {
  const fields: Field[] = [
    f({
      name: 'office_items',
      label: 'Office items',
      type: 'array',
      children: [
        f({ name: 'description' }),
        f({ name: 'item_value', label: 'Item value', type: 'money' }),
      ],
    }),
  ];
  const out = buildInputs(fields, {
    office_items: [{ description: 'Desk', item_value: '10000' }],
  });
  const rows = out.office_items as Record<string, unknown>[];
  assert.equal(rows[0].item_value, 1_000_000, '₦10,000 → 1,000,000 kobo');
});

// ── THE SEAM PIN ────────────────────────────────────────────────────────────
//
// This bug existed because neither side of the boundary stated which unit
// crossed it, and each assumed the other converted. Both sides now declare it.
// This test fails the moment they stop agreeing.

test('the unit this app submits is the unit the Go adapter converts from', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const goContract = resolve(here, '../../../../../../backend/internal/insurance/gateway/form_money.go');
  const src = readFileSync(goContract, 'utf8');

  const m = /MoneyInputWireUnit\s*=\s*"([a-z]+)"/.exec(src);
  assert.ok(m, `${goContract} no longer declares MoneyInputWireUnit — the seam is undocumented again`);
  assert.equal(
    MONEY_WIRE_UNIT,
    m![1],
    'SEAM BROKEN: this app submits money inputs in a different unit from the one the Go adapter converts from. ' +
      'One of the two is applying the wrong scale to every declared value.',
  );
});
