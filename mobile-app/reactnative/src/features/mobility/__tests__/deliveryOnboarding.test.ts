import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredDocumentsFor,
  canContinueServicesStep,
  resolveOnboardingOptions,
  SERVICE_INTERESTS,
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
  assert.equal(canContinueServicesStep([], ['ikeja']), false);
  assert.equal(canContinueServicesStep(['rides'], ['ikeja']), true);
});

test('onboarding options fall back to the built-in lists when the fetch fails', async () => {
  const r = await resolveOnboardingOptions(async () => {
    throw new Error('offline');
  });
  assert.deepEqual(r.services, SERVICE_INTERESTS);
  assert.deepEqual(r.coverageAreas, COVERAGE_FALLBACK);
});
