// Only the estate manager may resolve an emergency alert (server enforces it in
// frontend-web .../emergencies/[id]/resolve). The Resolve action is hidden for
// everyone else; unknown role data fails closed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canResolveEmergency } from '@/features/emergencies/permissions';
import type { ContextEnvelope } from '@/features/property/types';

const env = (contexts: ContextEnvelope['contexts']): ContextEnvelope => ({ activeContext: null, contexts });

describe('canResolveEmergency', () => {
  test('true for an estate context carrying estate_admin', () => {
    assert.equal(canResolveEmergency(env([{ type: 'estate', id: 'e1', name: 'E', roles: ['resident', 'estate_admin'] }])), true);
  });
  test('false for a plain resident', () => {
    assert.equal(canResolveEmergency(env([{ type: 'estate', id: 'e1', name: 'E', roles: ['resident', 'tenant'] }])), false);
  });
  test('false when estate_admin is on a non-estate context', () => {
    assert.equal(canResolveEmergency(env([{ type: 'agency', id: 'a1', name: 'A', roles: ['estate_admin'] }])), false);
  });
  test('fails closed when context is missing', () => {
    assert.equal(canResolveEmergency(undefined), false);
    assert.equal(canResolveEmergency(null), false);
    assert.equal(canResolveEmergency(env([])), false);
  });
});
