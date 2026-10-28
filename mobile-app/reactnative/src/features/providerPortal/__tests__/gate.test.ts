import test from 'node:test';
import assert from 'node:assert/strict';

import { decideGate, mapCapability, type GateRule, type ProviderCapability } from '../gate.ts';

const vetRule: GateRule = { type: 'vet', prefix: '/health/vet/provider', open: ['onboarding', 'verification'] };
const doctorRule: GateRule = { type: 'doctor', prefix: '', open: ['onboarding', 'profile/setup'] };

const cap = (type: ProviderCapability['type'], approved: boolean): ProviderCapability => ({
  type, providerId: 'p1', displayName: 'X', status: approved ? 'APPROVED' : 'PENDING', approved,
});

test('a path outside the rule prefix is never gated', () => {
  assert.deepEqual(decideGate('/health/vet/find-vet', [vetRule], []), { kind: 'allow' });
  assert.deepEqual(decideGate('/health/vet/providerx', [vetRule], []), { kind: 'allow' });
});

test('a non-provider is denied on a provider screen', () => {
  assert.deepEqual(decideGate('/health/vet/provider/earnings', [vetRule], []), { kind: 'deny', type: 'vet' });
});

test('a provider of another type is denied', () => {
  assert.deepEqual(decideGate('/health/vet/provider/earnings', [vetRule], [cap('pharmacy', true)]), { kind: 'deny', type: 'vet' });
});

test('an unapproved record is pending, not allowed', () => {
  assert.deepEqual(decideGate('/health/vet/provider/earnings', [vetRule], [cap('vet', false)]), { kind: 'pending', type: 'vet' });
});

test('an approved record is allowed', () => {
  assert.deepEqual(decideGate('/health/vet/provider/earnings', [vetRule], [cap('vet', true)]), { kind: 'allow' });
});

test('onboarding screens stay reachable without approval', () => {
  assert.deepEqual(decideGate('/health/vet/provider/onboarding', [vetRule], []), { kind: 'allow' });
  assert.deepEqual(decideGate('/health/vet/provider/verification/', [vetRule], []), { kind: 'allow' });
  // but a look-alike sibling is not an open path
  assert.deepEqual(decideGate('/health/vet/provider/onboardingx', [vetRule], []), { kind: 'deny', type: 'vet' });
});

test('query strings and trailing slashes do not change the decision', () => {
  assert.deepEqual(decideGate('/health/vet/provider/earnings/?x=1', [vetRule], []), { kind: 'deny', type: 'vet' });
});

test('an empty prefix gates the whole group except its open paths', () => {
  assert.deepEqual(decideGate('/appointments', [doctorRule], []), { kind: 'deny', type: 'doctor' });
  assert.deepEqual(decideGate('/onboarding/intro', [doctorRule], []), { kind: 'allow' });
  assert.deepEqual(decideGate('/profile/setup/bio', [doctorRule], []), { kind: 'allow' });
  assert.deepEqual(decideGate('/appointments', [doctorRule], [cap('doctor', true)]), { kind: 'allow' });
});

test('mapCapability reads the wire shape and fails closed on a bad approved flag', () => {
  const c = mapCapability({ type: 'vet', provider_id: 'a', display_name: 'V', status: 'PENDING', approved: 'yes' as never });
  assert.equal(c.approved, false);
  assert.equal(c.providerId, 'a');
});

test('case and repeated slashes cannot slip past a gated prefix', () => {
  assert.deepEqual(decideGate('/Health/Vet/Provider/Earnings', [vetRule], []), { kind: 'deny', type: 'vet' });
  assert.deepEqual(decideGate('/health//vet/provider//earnings', [vetRule], []), { kind: 'deny', type: 'vet' });
});
