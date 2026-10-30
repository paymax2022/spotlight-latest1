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

test('an exact rule gates only its own path, never a customer child route', () => {
  const restaurantRoot: GateRule = { type: 'restaurant', prefix: '/food/restaurant', exact: true };
  // the owner console root is gated
  assert.deepEqual(decideGate('/food/restaurant', [restaurantRoot], []), { kind: 'deny', type: 'restaurant' });
  // a customer opening one outlet's page is not
  assert.deepEqual(decideGate('/food/restaurant/928928e1', [restaurantRoot], []), { kind: 'allow' });
  assert.deepEqual(decideGate('/food/restaurant/928928e1', [restaurantRoot], [cap('restaurant', true)]), { kind: 'allow' });
});

test('the rider and restaurant consoles are gated by their own capabilities', () => {
  const rules: GateRule[] = [
    { type: 'restaurant', prefix: '/food/restaurant/manage' },
    { type: 'rider', prefix: '/food/rider' },
  ];
  assert.deepEqual(decideGate('/food/restaurant/manage', rules, [cap('rider', true)]), { kind: 'deny', type: 'restaurant' });
  assert.deepEqual(decideGate('/food/rider', rules, [cap('restaurant', true)]), { kind: 'deny', type: 'rider' });
  assert.deepEqual(decideGate('/food/restaurant/manage', rules, [cap('restaurant', true)]), { kind: 'allow' });
  assert.deepEqual(decideGate('/food/rider', rules, [cap('rider', true)]), { kind: 'allow' });
});

test('every business type gates its own area', () => {
  const rules: GateRule[] = [
    { type: 'driver', prefix: '/mobility/driver', open: ['onboarding'] },
    { type: 'bus_owner', prefix: '/mobility/bus/provider', open: ['register'] },
    { type: 'event_organiser', prefix: '/events/organiser', open: ['create'] },
    { type: 'estate_manager', prefix: '/estate-admin' },
    { type: 'property_manager', prefix: '/property/roles' },
    { type: 'association_creator', prefix: '/association/admin' },
    { type: 'crowdfunding_creator', prefix: '/crowdfunding/creator' },
  ];
  const cases: Array<[string, ProviderCapability['type']]> = [
    ['/mobility/driver', 'driver'],
    ['/mobility/bus/provider', 'bus_owner'],
    ['/events/organiser/dashboard', 'event_organiser'],
    ['/estate-admin/residents', 'estate_manager'],
    ['/property/roles', 'property_manager'],
    ['/association/admin', 'association_creator'],
    ['/crowdfunding/creator/campaigns', 'crowdfunding_creator'],
  ];
  for (const [path, type] of cases) {
    assert.deepEqual(decideGate(path, rules, []), { kind: 'deny', type }, `${path} must deny a stranger`);
    assert.deepEqual(decideGate(path, rules, [cap(type, true)]), { kind: 'allow' }, `${path} must allow ${type}`);
  }
  // applications stay reachable before approval
  assert.deepEqual(decideGate('/mobility/driver/onboarding', rules, []), { kind: 'allow' });
  assert.deepEqual(decideGate('/mobility/bus/provider/register', rules, []), { kind: 'allow' });
  assert.deepEqual(decideGate('/events/organiser/create', rules, []), { kind: 'allow' });
});
