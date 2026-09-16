import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageCommittees, canManageCommitteeRoster } from '../utils/committeePermissions.ts';

// The rule: an owner controls committees, a member only uses them. The server
// enforces it; this keeps the UI from offering actions that would 403.

test('owner with an org may create and delete', () => {
  assert.equal(
    canManageCommittees({ isAdmin: true, organisationId: 'org-1', can: { manageCommittees: true } }),
    true,
  );
});

test('a chapter admin may run the roster but not the lifecycle', () => {
  const chapterAdmin = {
    isAdmin: true,
    organisationId: 'org-1',
    can: { manageMembers: true, manageCommittees: false },
  };
  assert.equal(canManageCommittees(chapterAdmin), false, 'must not create or delete');
  assert.equal(canManageCommitteeRoster(chapterAdmin), true, 'keeps roster management');
});

test('a plain member gets neither', () => {
  const member = { isAdmin: false, organisationId: 'org-1', can: {} };
  assert.equal(canManageCommittees(member), false);
  assert.equal(canManageCommitteeRoster(member), false);
});

test('the capability alone is not enough — an org id is needed to POST to', () => {
  assert.equal(
    canManageCommittees({ isAdmin: true, organisationId: null, can: { manageCommittees: true } }),
    false,
  );
});

test('a backend that does not report the flag yields false, never an accidental true', () => {
  assert.equal(canManageCommittees({ isAdmin: true, organisationId: 'org-1', can: {} }), false);
  assert.equal(canManageCommittees({ isAdmin: true, organisationId: 'org-1' }), false);
  assert.equal(canManageCommittees(null), false);
  assert.equal(canManageCommittees(undefined), false);
});
