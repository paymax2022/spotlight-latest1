import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredDocumentsFor,
  canContinueServicesStep,
  resolveOnboardingOptions,
  pickStringArray,
  areaSlug,
  areasForState,
  coverageAreaLabel,
  coverageStateOf,
  SERVICE_INTERESTS,
  STATE_OPTIONS,
  COVERAGE_FALLBACK,
} from '../deliveryOnboarding.ts';

test('bicycle needs only ID + proof of address', () => {
  assert.deepEqual(requiredDocumentsFor('bicycle'), ['government_id', 'proof_of_address']);
});

test('motorcycle adds a driver licence but not vehicle papers', () => {
  const d = requiredDocumentsFor('motorcycle');
  assert.ok(d.includes('drivers_licence'));
  assert.ok(!d.includes('vehicle_insurance'));
  assert.ok(!d.includes('roadworthiness'));
});

test('car requires licence, insurance and roadworthiness', () => {
  const d = requiredDocumentsFor('car');
  assert.ok(d.includes('drivers_licence') && d.includes('vehicle_insurance') && d.includes('roadworthiness'));
});

test('services step needs at least one service and one area', () => {
  assert.equal(canContinueServicesStep([], []), false);
  assert.equal(canContinueServicesStep(['rides'], []), false);
  assert.equal(canContinueServicesStep([], ['lagos/ikeja']), false);
  assert.equal(canContinueServicesStep(['rides'], ['lagos/ikeja']), true);
});

// The Go allow-list is generated with the same rule from the same dataset; a
// divergence here shows up as the server rejecting what the app just offered.
test('areaSlug matches the server rule', () => {
  assert.equal(areaSlug('Lagos'), 'lagos');
  assert.equal(areaSlug('FCT - Abuja'), 'fct_abuja');
  assert.equal(areaSlug('Irepodun/Ifelodun'), 'irepodun_ifelodun');
  assert.equal(areaSlug('  Ogun  '), 'ogun');
});

test('states cover the 36 states plus the FCT', () => {
  assert.equal(STATE_OPTIONS.length, 37);
  assert.ok(STATE_OPTIONS.some((s) => s.value === 'lagos'));
  assert.ok(STATE_OPTIONS.some((s) => s.label === 'FCT - Abuja' && s.value === 'fct_abuja'));
});

test('coverage ids are namespaced per state and unique', () => {
  const seen = new Set(COVERAGE_FALLBACK.map((a) => a.value));
  assert.equal(seen.size, COVERAGE_FALLBACK.length);
  assert.ok(seen.has('lagos/ikeja'));
  // Same LGA name in two states stays two distinct ids.
  assert.ok(seen.has('kogi/bassa'));
  assert.ok(seen.has('plateau/bassa'));
  for (const a of COVERAGE_FALLBACK) assert.ok(a.value.startsWith(a.state + '/'), a.value);
});

test('areas are filtered to the chosen state', () => {
  assert.deepEqual(areasForState(COVERAGE_FALLBACK, ''), []);
  const lagos = areasForState(COVERAGE_FALLBACK, 'lagos');
  assert.ok(lagos.length > 0 && lagos.every((a) => a.state === 'lagos'));
  assert.ok(lagos.some((a) => a.label === 'Ikeja'));
});

test('coverageStateOf reads the namespace, tolerating legacy bare values', () => {
  assert.equal(coverageStateOf('lagos/ikeja'), 'lagos');
  assert.equal(coverageStateOf('ikeja'), '');
});

test('coverageAreaLabel resolves namespaced AND legacy stored values', () => {
  assert.equal(coverageAreaLabel('lagos/ikeja', COVERAGE_FALLBACK), 'Ikeja');
  // Drivers onboarded before the namespace change still stored bare slugs.
  assert.equal(coverageAreaLabel('ikeja', COVERAGE_FALLBACK), 'Ikeja');
  assert.equal(coverageAreaLabel('unknown_area', COVERAGE_FALLBACK), 'unknown_area');
});

test('onboarding options fall back to the built-in lists when the fetch fails', async () => {
  const r = await resolveOnboardingOptions(async () => {
    throw new Error('offline');
  });
  assert.deepEqual(r.services, SERVICE_INTERESTS);
  assert.deepEqual(r.states, STATE_OPTIONS);
  assert.deepEqual(r.coverageAreas, COVERAGE_FALLBACK);
});

test('a response missing states is treated as incomplete and falls back', async () => {
  const r = await resolveOnboardingOptions(async () => ({ services: SERVICE_INTERESTS, coverageAreas: COVERAGE_FALLBACK }) as never);
  assert.deepEqual(r.states, STATE_OPTIONS);
});

test('pickStringArray reads snake_case or camelCase, else empty', () => {
  assert.deepEqual(pickStringArray({ service_interests: ['rides'] }, 'serviceInterests', 'service_interests'), ['rides']);
  assert.deepEqual(pickStringArray({ serviceInterests: ['movers'] }, 'serviceInterests', 'service_interests'), ['movers']);
  assert.deepEqual(pickStringArray({}, 'serviceInterests', 'service_interests'), []);
  assert.deepEqual(pickStringArray(undefined, 'serviceInterests'), []);
});
