// The schema-driven form engine — the piece the whole buy flow rests on.
//   node --experimental-strip-types --test src/features/insurance/__tests__/live-form-engine.test.ts
//
// Every schema below is a real MyCover one, verified live (see
// docs/prd/Insurance/MYCOVER-API-MAP.md). Testing against invented schemas would
// prove nothing — the point of this module is that it handles the ones that
// actually exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInputs,
  buildSteps,
  declaredValueKobo,
  fallbackPlanOptions,
  familyPlans,
  firstErroredStep,
  isVisible,
  optionsQueryFor,
  planIdValue,
  prefillFromProfile,
  priceDrivingFields,
  validateAll,
  validateField,
  validateStep,
} from '../live/formEngine.ts';
import type { Field, FormValues } from '../live/types.ts';

const f = (over: Partial<Field> & { name: string }): Field => ({
  label: over.name,
  type: 'text',
  required: false,
  ...over,
});

// ── Bastion health family, verified live ────────────────────────────────────
const BASTION: Field[] = [
  f({ name: 'first_name', label: 'First name', required: true, minLength: 2 }),
  f({ name: 'last_name', label: 'Last name', required: true, minLength: 2 }),
  f({ name: 'email', label: 'Email', type: 'email', required: true }),
  f({ name: 'phone_number', label: 'Phone number', type: 'phone', required: true }),
  f({ name: 'date_of_birth', label: 'Date of birth', type: 'date', required: true, maxDate: 'today' }),
  f({
    name: 'gender',
    label: 'Gender',
    type: 'select',
    required: true,
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
    ],
  }),
  f({ name: 'nin', label: 'NIN', type: 'nin', required: true, minLength: 11, maxLength: 11 }),
  f({ name: 'image_url', label: 'Passport photo', type: 'image', required: true }),
  f({ name: 'payment_plan', label: 'Payment plan', type: 'number', required: true, min: 1, max: 12 }),
  f({ name: 'product_id', label: 'Product', type: 'text', required: true, hidden: true }),
];

// ── Validation ──────────────────────────────────────────────────────────────
test('NIN must be exactly 11 digits, as the provider enforces', () => {
  const nin = BASTION.find((x) => x.name === 'nin')!;
  assert.equal(validateField(nin, '12345678901'), null);
  assert.match(String(validateField(nin, '1234567890')), /exactly 11/);
  assert.match(String(validateField(nin, '1234567890a')), /digits only|exactly 11/);
  assert.match(String(validateField(nin, '')), /required/);
});

test('a future date of birth is rejected before the round trip', () => {
  const dob = BASTION.find((x) => x.name === 'date_of_birth')!;
  assert.equal(validateField(dob, '1990-04-12'), null);
  const nextYear = `${new Date().getFullYear() + 1}-01-01`;
  assert.match(String(validateField(dob, nextYear)), /in the past/);
});

test('a money bound stated in NAIRA is scaled, not read as kobo', () => {
  // device_value >= 50000 means ₦50,000. Reading it as kobo would accept a ₦500
  // phone — a money bug, not a display bug.
  const naira = f({ name: 'device_value', label: 'Device value', type: 'money', required: true, min: 50_000, unit: 'naira' });
  assert.match(String(validateField(naira, '500')), /at least ₦50,000/);
  assert.equal(validateField(naira, '50000'), null);

  // The same rule declared in kobo (the contract default) behaves identically.
  const kobo = f({ name: 'device_value', label: 'Device value', type: 'money', required: true, min: 5_000_000 });
  assert.match(String(validateField(kobo, '500')), /at least ₦50,000/);
  assert.equal(validateField(kobo, '50000'), null);
});

test('a provider regex is applied verbatim', () => {
  const nin = f({ name: 'nin', label: 'NIN', type: 'text', required: true, pattern: '^[0-9]{11}$' });
  assert.equal(validateField(nin, '12345678901'), null);
  assert.match(String(validateField(nin, 'abc')), /expected format/);
  // An unparseable pattern must not block the form on a rule we cannot evaluate.
  const broken = f({ name: 'x', label: 'X', pattern: '([' });
  assert.equal(validateField(broken, 'anything'), null);
});

test('an unfinished upload is caught rather than sent to the insurer', () => {
  const img = f({ name: 'image_url', label: 'Photo', type: 'image', required: true });
  assert.match(String(validateField(img, 'file:///tmp/pic.jpg')), /still uploading/);
  // The value is the provider's upload reference — a bare uuid is valid.
  assert.equal(validateField(img, '00157dbf-aee8-4fb3-94c4-041f971b7c5b'), null);
});

test('optional and blank passes everything else', () => {
  const opt = f({ name: 'nin', label: 'NIN', type: 'nin', required: false });
  assert.equal(validateField(opt, ''), null);
});

// ── Dependent fields ────────────────────────────────────────────────────────
test('a dependent field is hidden, unvalidated and unsent until its controller matches', () => {
  const fields = [
    f({ name: 'is_business_policy', label: 'Business', type: 'boolean', required: true }),
    f({
      name: 'cac_url',
      label: 'CAC document',
      type: 'file',
      required: true,
      dependsOn: { field: 'is_business_policy', equals: 'true' },
    }),
  ];
  const individual: FormValues = { is_business_policy: 'false' };
  assert.equal(isVisible(fields[1], individual), false);
  // A required field the user cannot see must never block the form…
  assert.deepEqual(validateAll(fields, individual), {});
  // …nor leak into the payload.
  assert.deepEqual(Object.keys(buildInputs(fields, individual)), ['is_business_policy']);

  const business: FormValues = { is_business_policy: 'true' };
  assert.equal(isVisible(fields[1], business), true);
  assert.ok(validateAll(fields, business).cac_url);
});

test('an options-only dependency does not hide the field, it gates the lookup', () => {
  const model = f({
    name: 'vehicle_model',
    label: 'Vehicle model',
    type: 'select',
    required: true,
    remoteOptions: true,
    dependsOn: { field: 'vehicle_make', queryParam: true },
  });
  // The field is visible from the start — it is the OPTIONS that wait.
  assert.equal(isVisible(model, {}), true);
  // '' means "parent unanswered": the caller must not fetch, because the
  // provider returns [] and the dropdown becomes permanently unopenable.
  assert.equal(optionsQueryFor(model, {}), '');
  assert.equal(optionsQueryFor(model, { vehicle_make: 'Toyota' }), 'Toyota');
  // A field with no such dependency reports null, i.e. fetch immediately.
  assert.equal(optionsQueryFor(f({ name: 'colour', remoteOptions: true }), {}), null);
});

// ── Hidden / system fields ──────────────────────────────────────────────────
test('product_id is submitted but never shown or demanded of the user', () => {
  const values: FormValues = { product_id: 'b0d0f39c-0b8a-452f-a876-78bef8de3347' };
  const hidden = BASTION.find((x) => x.name === 'product_id')!;
  assert.equal(isVisible(hidden, values), false);
  assert.equal(validateAll([hidden], {}).product_id, undefined);
  assert.equal(buildInputs([hidden], values).product_id, values.product_id);
});

// ── Step chunking ───────────────────────────────────────────────────────────
test('a small schema stays on one page', () => {
  const small = BASTION.slice(0, 4);
  const steps = buildSteps({ fields: small }, {});
  assert.equal(steps.length, 1);
});

test('a large schema is chunked, and no step exceeds the cap', () => {
  const steps = buildSteps({ fields: BASTION }, {});
  assert.ok(steps.length > 1, 'a 10-field schema should not be one endless scroll');
  for (const s of steps) assert.ok(s.fields.length <= 6, `${s.key} has ${s.fields.length} fields`);
  // The hidden product_id is never given to a step to render.
  assert.ok(!steps.some((s) => s.fields.some((x) => x.name === 'product_id')));
  // Every visible field lands in exactly one step.
  const placed = steps.flatMap((s) => s.fields.map((x) => x.name)).sort();
  const expected = BASTION.filter((x) => !x.hidden).map((x) => x.name).sort();
  assert.deepEqual(placed, expected);
});

test('nested blocks and repeating groups get a step of their own', () => {
  const fields = [
    ...BASTION.slice(0, 7),
    f({
      name: 'policy_holder',
      label: 'Policy holder',
      type: 'object',
      required: true,
      children: [f({ name: 'first_name', label: 'First name', required: true })],
    }),
    f({
      name: 'office_items',
      label: 'Office items',
      type: 'array',
      required: true,
      children: [f({ name: 'item_name', label: 'Item', required: true })],
    }),
  ];
  const steps = buildSteps({ fields }, {});
  const composite = steps.filter((s) =>
    s.fields.some((x) => x.type === 'object' || x.type === 'array'),
  );
  assert.equal(composite.length, 2);
  for (const s of composite) assert.equal(s.fields.length, 1);
});

// ── Server-error attribution ────────────────────────────────────────────────
test('a server field error routes to the step that owns the input', () => {
  const steps = buildSteps({ fields: BASTION }, {});
  const target = firstErroredStep(steps, { nin: 'nin must be exactly 11 characters' });
  assert.ok(target >= 0);
  assert.ok(steps[target].fields.some((x) => x.name === 'nin'));
  // An error for a field we do not render reports -1 so the caller shows a
  // banner rather than swallowing it.
  assert.equal(firstErroredStep(steps, { unknown_field: 'nope' }), -1);
});

test('validateStep only judges its own step', () => {
  const steps = buildSteps({ fields: BASTION }, {});
  const first = steps[0];
  const errors = validateStep(first, {});
  for (const key of Object.keys(errors)) {
    assert.ok(first.fields.some((x) => x.name === key));
  }
});

// ── Payload building ────────────────────────────────────────────────────────
test('the payload carries typed values, nested objects and repeating rows', () => {
  const fields = [
    f({ name: 'value', label: 'Value', type: 'money', required: true }),
    f({ name: 'seats', label: 'Seats', type: 'number' }),
    f({ name: 'is_business_policy', label: 'Business', type: 'boolean' }),
    f({
      name: 'policy_holder',
      label: 'Policy holder',
      type: 'object',
      children: [f({ name: 'first_name', label: 'First name' })],
    }),
    f({
      name: 'office_items',
      label: 'Office items',
      type: 'array',
      children: [f({ name: 'item_name', label: 'Item' })],
    }),
  ];
  const out = buildInputs(fields, {
    value: '2000',
    seats: '4',
    is_business_policy: 'true',
    policy_holder: { first_name: 'Ada' },
    office_items: [{ item_name: 'Laptop' }, { item_name: 'Printer' }],
  });
  assert.equal(out.value, 200_000);           // money → integer kobo
  assert.equal(out.seats, 4);                 // number stays a number
  assert.equal(out.is_business_policy, true); // boolean stays a boolean
  assert.deepEqual(out.policy_holder, { first_name: 'Ada' });
  assert.deepEqual(out.office_items, [{ item_name: 'Laptop' }, { item_name: 'Printer' }]);
});

test('the declared value a percentage plan is rated on is found in kobo', () => {
  const fields = [f({ name: 'device_value', label: 'Device value', type: 'money' })];
  assert.equal(declaredValueKobo(fields, { device_value: '250000' }), 25_000_000);
  assert.equal(declaredValueKobo(fields, {}), 0);
});

// ── Prefill ─────────────────────────────────────────────────────────────────
test('prefill fills only declared fields and never overwrites the user', () => {
  const seeded = prefillFromProfile(
    BASTION,
    { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08031234567' },
    { last_name: 'Typed-by-hand' },
  );
  assert.equal(seeded.first_name, 'Ada');
  assert.equal(seeded.last_name, 'Typed-by-hand');
  assert.equal(seeded.email, 'ada@example.com');
  assert.equal(seeded.phone_number, '08031234567');
  assert.equal(seeded.nin, undefined); // not in the profile, so not invented
});

// ── Plans & pricing levers ──────────────────────────────────────────────────
test('sibling plans group by family and always include the product itself', () => {
  const plan = (code: string, familyCode: string) => ({ code, familyCode, productLine: 'health' });
  const catalog = [plan('a', 'bastion'), plan('b', 'bastion'), plan('c', 'goxi')];
  assert.deepEqual(familyPlans(catalog[0], catalog).map((p) => p.code), ['a', 'b']);
  // An empty catalog still yields a family of one rather than nothing.
  assert.deepEqual(familyPlans(catalog[0], []).map((p) => p.code), ['a']);
  assert.deepEqual(familyPlans(null, catalog), []);
});

test('the plan id sent as product_id prefers the aggregator uuid', () => {
  assert.equal(planIdValue({ providerProductId: 'uuid-1', code: 'local' }), 'uuid-1');
  // Falling back to the local code lets the provider reject it visibly, rather
  // than the app silently buying the wrong plan.
  assert.equal(planIdValue({ providerProductId: null, code: 'local' }), 'local');
});

test('payment_plan is recognised as price-driving and offered as real choices', () => {
  const levers = priceDrivingFields(BASTION);
  assert.deepEqual(levers.map((x) => x.name), ['payment_plan']);
  const options = fallbackPlanOptions(levers[0]);
  assert.deepEqual(options.map((o) => o.value), ['1', '3', '6', '12']);
  assert.equal(options[0].label, 'Pay in full');
  // A schema with no such field offers no selector at all.
  assert.deepEqual(priceDrivingFields([f({ name: 'first_name' })]), []);
});
