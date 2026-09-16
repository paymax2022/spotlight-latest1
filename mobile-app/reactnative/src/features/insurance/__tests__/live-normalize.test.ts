// The wire → domain boundary for the live MyCover integration.
//   node --experimental-strip-types --test src/features/insurance/__tests__/live-normalize.test.ts
//
// The rows below are the shapes the provider and the backend really emit,
// including MyCover's own `product_table_data` layout (constraints under
// `validation`, options under `data_source`) — see
// docs/prd/Insurance/MYCOVER-API-MAP.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeMessage,
  humanizeName,
  intKobo,
  mapClaim,
  mapField,
  mapFieldOptions,
  mapFormSchema,
  mapPolicy,
  mapProduct,
  mapProducts,
  toFieldType,
  toInsuranceError,
  toProductLine,
  unwrapList,
} from '../live/normalize.ts';

// ── Envelope ────────────────────────────────────────────────────────────────
test('the list unwrapper accepts every envelope the backend uses', () => {
  assert.equal(unwrapList([1, 2]).length, 2);
  assert.equal(unwrapList({ data: [1, 2, 3] }).length, 3);
  assert.equal(unwrapList({ data: { products: [1] } }).length, 1);
  // A shape we do not recognise yields an empty list, never a throw — one odd
  // row must not blank a 69-product catalog.
  assert.deepEqual(unwrapList({ data: { nope: 1 } }), []);
  assert.deepEqual(unwrapList(null), []);
});

// ── Money ───────────────────────────────────────────────────────────────────
test('money coercion truncates and never yields NaN', () => {
  assert.equal(intKobo(600000), 600000);
  assert.equal(intKobo('600000'), 600000);
  assert.equal(intKobo('600000.9'), 600000); // truncated, never rounded up
  assert.equal(intKobo(undefined), 0);
  assert.equal(intKobo('not a number'), 0);
});

// ── Product ─────────────────────────────────────────────────────────────────
const FLAT_ROW = {
  code: 'goxi-artisan-basic',
  name: 'Artisan Basic',
  description: 'Cover for artisans',
  product_line: 'life',
  underwriter: 'Goxi MicroInsurance',
  underwriter_logo_url: 'https://example.test/goxi.png',
  aggregator: 'mycover',
  base_price_kobo: 50_000,
  is_percentage: false,
  sum_insured_kobo: 10_000_000,
  cover_period_days: 7,
  is_renewable: true,
  is_claimable: true,
  is_certificateable: true,
  key_benefits_html: '<p>Cover</p>',
  active: true,
  purchasable: true,
  prefix: 'goxi',
  provider_product_id: '6e417faa-e042-4768-8d5d-916fd531a478',
};

test('a flat product maps to integer kobo and no rate', () => {
  const p = mapProduct(FLAT_ROW);
  assert.equal(p.code, 'goxi-artisan-basic');
  assert.equal(p.productLine, 'life');
  assert.equal(p.basePriceKobo, 50_000);
  assert.equal(p.isPercentage, false);
  assert.equal(p.rateBps, 0);
  assert.equal(p.purchasable, true);
  assert.equal(p.familyCode, 'goxi'); // the aggregator prefix groups siblings
  assert.equal(p.providerProductId, '6e417faa-e042-4768-8d5d-916fd531a478');
});

test('a percentage product carries a rate in bps, not a naira amount', () => {
  const p = mapProduct({ ...FLAT_ROW, is_percentage: true, rate_bps: 50, base_price_kobo: 50 });
  assert.equal(p.isPercentage, true);
  assert.equal(p.rateBps, 50);
});

test('a product broken provider-side is listed but not sellable', () => {
  const p = mapProduct({
    ...FLAT_ROW,
    purchasable: false,
    provider_config_status: 'Product purchase config doesn’t exist',
  });
  assert.equal(p.active, true);
  assert.equal(p.purchasable, false);
  assert.ok(p.providerConfigStatus);
});

test('active and purchasable both default TRUE when the backend omits them', () => {
  const p = mapProduct({ code: 'x', name: 'X' });
  assert.equal(p.active, true);
  assert.equal(p.purchasable, true);
});

test('mapping a garbage row never throws and never emits a codeless product', () => {
  assert.doesNotThrow(() => mapProduct({}));
  assert.doesNotThrow(() => mapProduct({ base_price_kobo: 'nonsense', category: 42 }));
  assert.equal(mapProducts({ data: [{ name: 'no code' }, FLAT_ROW] }).length, 1);
});

test('product lines fold onto the seven real categories', () => {
  assert.equal(toProductLine('Auto'), 'auto');
  assert.equal(toProductLine('MOTOR'), 'auto');       // older internal vocabulary
  assert.equal(toProductLine('device'), 'gadget');
  assert.equal(toProductLine('goods_in_transit'), 'package');
  assert.equal(toProductLine('something new'), 'package');
});

// ── Fields ──────────────────────────────────────────────────────────────────
test('a provider field table maps with its constraints intact', () => {
  // Exactly the shape GET /v2/public-product-details/{id} returns.
  const gender = mapField({
    name: 'gender',
    label: 'Gender',
    type: 'string',
    required: true,
    description: 'Select your gender',
    data_source: '[Male, Female]',
    validation: { enum: ['Male', 'Female'], type: 'string' },
  });
  assert.equal(gender.type, 'select');
  assert.equal(gender.required, true);
  assert.deepEqual(gender.options?.map((o) => o.value), ['Male', 'Female']);
  assert.equal(gender.help, 'Select your gender');

  const value = mapField({
    name: 'value',
    label: 'Vehicle Value',
    type: 'number',
    required: true,
    data_source: 'User input',
    validation: { type: 'number', minimum: 1_000_000 },
  });
  assert.equal(value.type, 'number');
  assert.equal(value.min, 1_000_000);

  const nin = mapField({
    name: 'nin',
    label: 'NIN',
    type: 'string',
    required: false,
    validation: { type: 'string', pattern: '^[0-9]{11}$' },
  });
  assert.equal(nin.pattern, '^[0-9]{11}$');
});

test('a data_source URL becomes "fetch the options", never a URL we follow', () => {
  const make = mapField({
    name: 'vehicle_make',
    label: 'Vehicle Make',
    type: 'string',
    required: true,
    data_source: 'https://v2.api.mycover.ai/v2/products/utility/fa2fb85f-9d1a-4652-a136-9da8e4c57c5c',
    validation: { type: 'string' },
  });
  assert.equal(make.remoteOptions, true);
  assert.equal(make.options, undefined);
  // The provider URL is deliberately NOT carried onto the client model.
  assert.equal(JSON.stringify(make).includes('mycover.ai'), false);
});

test('date_of_birth gets a past-date bound even when the schema omits it', () => {
  const dob = mapField({ name: 'date_of_birth', type: 'date', required: true });
  assert.equal(dob.maxDate, 'today');
  const purchase = mapField({ name: 'date_of_purchase', type: 'date', required: true });
  assert.equal(purchase.maxDate, undefined);
});

test('product_id is hidden without the backend having to say so', () => {
  assert.equal(mapField({ name: 'product_id', type: 'string', required: true }).hidden, true);
  assert.equal(mapField({ name: 'first_name', type: 'string' }).hidden, undefined);
});

test('nested and repeating fields keep their child shape', () => {
  const schema = mapFormSchema({
    fields: [
      {
        name: 'policy_holder',
        label: 'Policy holder',
        type: 'object',
        required: true,
        children: [{ name: 'first_name', type: 'string', required: true }],
      },
      {
        name: 'office_items',
        label: 'Office items',
        type: 'array',
        required: true,
        children: [{ name: 'item_name', type: 'string', required: true }],
      },
    ],
  });
  assert.equal(schema?.fields.length, 2);
  assert.equal(schema?.fields[0].type, 'object');
  assert.equal(schema?.fields[0].children?.[0].name, 'first_name');
  assert.equal(schema?.fields[1].type, 'array');
});

test('an unknown field type degrades to text rather than being dropped', () => {
  // A field we cannot draw is still a field the purchase fails without.
  assert.equal(toFieldType('some-new-thing'), 'text');
  assert.equal(toFieldType('boolean'), 'boolean');
  assert.equal(toFieldType('array'), 'array');
  assert.equal(toFieldType('integer'), 'number');
});

test('a field name becomes a readable label, with acronyms preserved', () => {
  assert.equal(humanizeName('first_name'), 'First name');
  assert.equal(humanizeName('cargoValue'), 'Cargo value');
  assert.equal(humanizeName('nin'), 'NIN');
  assert.equal(humanizeName('lga'), 'LGA');
});

test('the hospital-list object never becomes a screenful of [object Object]', () => {
  // Utilities return [{label,value}] — except the hospital list, which returns
  // an object. Routing that through the option loader must yield nothing.
  assert.deepEqual(mapFieldOptions({ data: { name: 'Bastion', hospitals: [{}] } }), []);
  assert.deepEqual(
    mapFieldOptions({ data: [{ label: 'Toyota', value: 'Toyota' }] }).map((o) => o.value),
    ['Toyota'],
  );
});

// ── Policy & claim ──────────────────────────────────────────────────────────
test('a policy carries the insurer’s hosted claim link', () => {
  const p = mapPolicy({
    id: 'pol-1',
    policy_ref: 'PMX-001',
    product_name: 'FlexiCare Mini',
    status: 'active',
    premium_kobo: 400_000,
    sum_insured_kobo: 50_000_000,
    claim_url: 'https://mycover.ai/purchase?q=abc',
    inspection_url: 'https://mycover.ai/purchase?q=def',
  });
  assert.equal(p.status, 'active');
  assert.equal(p.premiumKobo, 400_000);
  assert.equal(p.claimUrl, 'https://mycover.ai/purchase?q=abc');
  assert.equal(p.inspectionUrl, 'https://mycover.ai/purchase?q=def');
});

test('an unapproved claim reports null, not zero', () => {
  // Zero would render as "₦0 approved", which reads as a refusal to pay.
  const c = mapClaim({ id: 'c1', policy_id: 'p1', status: 'under_review', claimed_amount_kobo: 500_000 });
  assert.equal(c.approvedAmountKobo, null);
  assert.equal(mapClaim({ id: 'c2', approved_amount_kobo: 0 }).approvedAmountKobo, 0);
});

// ── Errors ──────────────────────────────────────────────────────────────────
test('a provider validation array lands on the fields that caused it', () => {
  // MyCover returns `responseText` as an ARRAY of strings on validation failure.
  const err = toInsuranceError({
    response: {
      status: 400,
      data: {
        error: {
          code: 'VALIDATION_FAILED',
          message: [
            'nin must be exactly 11 characters',
            'cargo_value must not be less than 5000',
          ],
        },
      },
    },
  });
  assert.equal(err.status, 400);
  assert.match(err.fieldErrors.nin, /exactly 11/);
  assert.match(err.fieldErrors.cargo_value, /5000/);
  // The friendly message for a known code is used in place of raw prose.
  assert.match(err.message, /need fixing/);
});

test('an explicit per-field map from the backend wins', () => {
  const err = toInsuranceError({
    response: { status: 422, data: { error: { code: 'X', fields: { email: 'Already used' } } } },
  });
  assert.equal(err.fieldErrors.email, 'Already used');
});

test('a network failure with no response is still a usable error', () => {
  const err = toInsuranceError({ message: 'Network Error' });
  assert.equal(err.status, null);
  assert.ok(err.message);
  assert.deepEqual(err.fieldErrors, {});
});

test('prose is not mistaken for a field name', () => {
  assert.equal(attributeMessage('Please try again later'), null);
  assert.deepEqual(attributeMessage('nin must be 11 digits'), {
    field: 'nin',
    message: 'Must be 11 digits',
  });
});
