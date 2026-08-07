// Pure-logic unit tests for the live insurance catalog normaliser.
// Run with Node's native TS type-stripping:
//   node --experimental-strip-types --test src/features/insurance/__tests__/normalize.test.ts
// No `@/` value imports in the chain (productLines.ts is design-token-free), so
// this loads under plain Node without an alias resolver hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCatalogList,
  mapCatalogProduct,
  unwrapList,
  unwrapOne,
} from '../normalize.ts';

// A representative raw row exactly as the Go catalog handler serialises it
// (snake_case, lowercase provider, int tier, jsonb objects).
const RAW_HEALTH = {
  code: 'mycover.health.micro.v1',
  display_name: 'MicroHealth Essential',
  product_line: 'HEALTH',
  provider: 'mycover',
  provider_product_code: 'MYCOVER-HEALTH-MICRO-V1',
  binding_mode: 'direct',
  underwriter_display: 'Hygeia HMO',
  premium_model: 'tiered',
  required_kyc_tier: 1,
  required_fields_schema_ref: {
    fields: [
      { name: 'fullName', type: 'string', required: true },
      { name: 'dateOfBirth', type: 'date', required: true },
      { name: 'dependents', type: 'integer', required: false },
    ],
  },
  sum_insured_rules: { min: 25000000, max: 200000000, basis: 'fixed' },
  cancellation_policy_ref: 'cancel-policy-health-v1',
  indicative_premium_kobo: 120000,
  premium_cadence: 'monthly',
  version: 1,
  active: true,
};

const RAW_GIT = {
  code: 'octamile.git.parcel.v1',
  display_name: 'Goods-in-Transit (Parcel)',
  product_line: 'GOODS_IN_TRANSIT',
  provider: 'octamile',
  binding_mode: 'embedded',
  underwriter_display: 'AXA Mansard',
  premium_model: 'per_shipment',
  required_kyc_tier: 1,
  sum_insured_rules: { min: 1000000, max: 500000000, basis: 'declared_value' },
  indicative_premium_kobo: 20000,
  premium_cadence: 'per-shipment',
  active: true,
};

test('unwrapList handles the {data:[...]} envelope, bare array, and junk', () => {
  assert.deepEqual(unwrapList({ data: [1, 2] }), [1, 2]);
  assert.deepEqual(unwrapList([3, 4]), [3, 4]);
  assert.deepEqual(unwrapList(null), []);
  assert.deepEqual(unwrapList({ nope: 1 }), []);
});

test('unwrapOne unwraps {data:{...}} and passes through bare objects', () => {
  assert.deepEqual(unwrapOne({ data: { a: 1 } }), { a: 1 });
  assert.deepEqual(unwrapOne({ a: 1 }), { a: 1 });
});

test('mapCatalogProduct maps snake_case Go row → camelCase InsuranceProduct', () => {
  const p = mapCatalogProduct(RAW_HEALTH);
  assert.equal(p.code, 'mycover.health.micro.v1');
  assert.equal(p.displayName, 'MicroHealth Essential');
  assert.equal(p.productLine, 'HEALTH');
  assert.equal(p.provider, 'MYCOVER');            // lowercase → enum
  assert.equal(p.bindingMode, 'VOLUNTARY');        // direct → VOLUNTARY
  assert.equal(p.premiumModel, 'TIERED');
  assert.equal(p.requiredKycTier, 'TIER_1');       // int → tier label
  assert.equal(p.fromPremiumKobo, 120000);         // indicative premium surfaced
  assert.equal(p.premiumCadence, 'monthly');
  assert.equal(p.disclosure.underwriter, 'Hygeia HMO');
  assert.equal(p.disclosure.aggregator, 'MyCover.ai');
  assert.deepEqual(p.sumInsuredRules, { min: 25000000, max: 200000000, basis: 'fixed' });
  assert.equal(p.icon, 'HeartPulse');              // derived from line
  assert.equal(p.shortDescription, 'Micro-health and hospital cover');
  assert.equal(p.active, true);
});

test('mapCatalogProduct maps the schema-driven quote fields (name→key, humanised label)', () => {
  const p = mapCatalogProduct(RAW_HEALTH);
  assert.equal(p.fieldsSchema.length, 3);
  assert.deepEqual(p.fieldsSchema[0], {
    key: 'fullName', label: 'Full Name', type: 'text', required: true,
  });
  assert.equal(p.fieldsSchema[1].type, 'date');
  assert.equal(p.fieldsSchema[2].type, 'number'); // integer → number
  assert.equal(p.fieldsSchema[2].required, false);
});

test('mapCatalogProduct handles the embedded Octamile rail', () => {
  const p = mapCatalogProduct(RAW_GIT);
  assert.equal(p.provider, 'OCTAMILE');
  assert.equal(p.disclosure.aggregator, 'Octamile');
  assert.equal(p.bindingMode, 'EMBEDDED');
  assert.equal(p.premiumModel, 'PER_SHIPMENT');
  assert.equal(p.premiumCadence, 'per-shipment');
  assert.equal(p.sumInsuredRules.basis, 'declared_value');
  assert.equal(p.icon, 'Truck');
  assert.deepEqual(p.fieldsSchema, []); // no schema on this row → empty, no throw
});

test('mapCatalogList unwraps + maps a full Go envelope', () => {
  const list = mapCatalogList({ data: [RAW_HEALTH, RAW_GIT] });
  assert.equal(list.length, 2);
  assert.equal(list[0].provider, 'MYCOVER');
  assert.equal(list[1].provider, 'OCTAMILE');
});

test('mapCatalogProduct never throws on a sparse/garbage row', () => {
  const p = mapCatalogProduct({ code: 'x' });
  assert.equal(p.provider, 'MYCOVER');   // default
  assert.equal(p.requiredKycTier, 'TIER_0');
  assert.equal(p.fromPremiumKobo, 0);
  assert.equal(p.premiumCadence, 'annual');
  assert.equal(p.icon, 'ShieldCheck');   // unknown line fallback
  assert.deepEqual(p.fieldsSchema, []);
});
