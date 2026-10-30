// Estate/visitor features are only enterable by members of an estate. The
// server resolves membership from estate_residents for every /api/v1/estate and
// /api/v1/visitor route; this predicate mirrors that answer on the client.
// Unknown or missing data fails closed so the hubs never offer actions the
// server would refuse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasEstateAccess } from '@/features/property/estateAccess';
import type { EstateMembership } from '@/features/property/types';

const member = (role = 'resident'): EstateMembership => ({
  isResident: true,
  estateId: 'e1',
  unit: 'B12',
  role,
});

describe('hasEstateAccess', () => {
  test('true for a resident', () => {
    assert.equal(hasEstateAccess(member()), true);
  });

  test('true for an estate admin', () => {
    assert.equal(hasEstateAccess(member('estate_admin')), true);
  });

  test('false when the server says the caller is not a resident', () => {
    assert.equal(hasEstateAccess({ isResident: false }), false);
  });

  test('fails closed while loading or after an error', () => {
    assert.equal(hasEstateAccess(undefined), false);
    assert.equal(hasEstateAccess(null), false);
  });

  test('fails closed on a malformed answer', () => {
    // A partial body (e.g. an old server) must not be read as membership.
    assert.equal(hasEstateAccess({ estateId: 'e1' } as unknown as EstateMembership), false);
  });
});
