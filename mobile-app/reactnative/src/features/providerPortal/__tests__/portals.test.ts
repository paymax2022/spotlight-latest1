import test from 'node:test';
import assert from 'node:assert/strict';

import { PORTAL_ROUTES, portalRoute } from '../portals.ts';

test('every provider type has a management home', () => {
  for (const [type, route] of Object.entries(PORTAL_ROUTES)) {
    assert.ok(route.home.length > 0, `${type} has no home route`);
  }
});

test('an approved provider opens its console', () => {
  assert.equal(portalRoute('doctor', true), '/(doctor)/(tabs)');
});

test('an unapproved provider is sent to its application flow', () => {
  assert.equal(portalRoute('doctor', false), '/(doctor)/onboarding');
});

test('a provider with no self-serve application opens its console anyway', () => {
  // estate_manager is granted with the estate itself, so there is nothing to apply for.
  assert.equal(portalRoute('estate_manager', false), '/estate-admin');
});
