import test from 'node:test';
import assert from 'node:assert/strict';

import { withOrgScope, resolveAdminOrgScope } from '../adminScope.ts';

// Why this file exists: the mobile admin console had no way to say WHICH
// organisation it was acting on. Every org-scoped read (`/admin/kpis`,
// `/admin/approvals`, `/admin/finance`, `/admin/audit-log`, `/members`) went out
// with no `org_id`, so the backend fell back to `resolveOrgID`'s membership
// lookup. A platform super-admin — whom `/me/admin-access` reports as
// `isAdmin:true, organisationId:null` — holds no `assoc_memberships` row, that
// lookup returns pgx.ErrNoRows, and the package error map writes it as a 404,
// which the screens rendered as a generic "Couldn't load / Please try again."
//
// The api modules themselves cannot be imported under `node --test` (they reach
// @/api/client, which pulls expo-router and the supabase polyfill), so the rule
// lives here and the api layer calls it — same split as doctor/mapping.ts.

test('no scope means no org_id, so an org-bound officer keeps the server-side membership scope', () => {
  assert.deepEqual(withOrgScope({}, null), {});
  assert.deepEqual(withOrgScope({}, undefined), {});
});

test('a blank scope is not sent: an empty org_id is ErrForbidden server-side', () => {
  // requireCapInOrg returns ErrForbidden for "" — forwarding a blank would turn
  // "no scope chosen yet" into a 403 the screen has to explain.
  assert.deepEqual(withOrgScope({ action: 'MEMBER_SUSPENDED' }, '   '), { action: 'MEMBER_SUSPENDED' });
  assert.deepEqual(withOrgScope({}, ''), {});
});

test('a scope rides as org_id — the Go form tag, not camelCase', () => {
  // MemberDirectoryQuery binds `form:"org_id"`; an `orgId` key is dropped in
  // silence and the request re-reads as unscoped, which is the bug returning.
  assert.deepEqual(withOrgScope({}, 'org-1'), { org_id: 'org-1' });
  assert.deepEqual(withOrgScope({ status: 'ACTIVE' }, 'org-1'), { status: 'ACTIVE', org_id: 'org-1' });
});

test('a scope is trimmed before it goes on the wire', () => {
  assert.deepEqual(withOrgScope({}, '  org-1  '), { org_id: 'org-1' });
});

const ORGS = [
  { id: 'org-1', name: 'Niger Delta Members Association' },
  { id: 'org-2', name: 'Lagos Chapter' },
];

test('an org-bound officer is scoped to their own org and never asked to pick', () => {
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: 'org-1', selection: null, orgs: ORGS }),
    { orgId: 'org-1', needsPick: false, isResolving: false },
  );
});

test('a stale stored selection cannot override an officer’s own org', () => {
  // Someone who was a super-admin, picked org-2, and now reads as an org-bound
  // officer must not be sent at org-2, where requireCapInOrg would 403 them.
  assert.equal(
    resolveAdminOrgScope({ ownOrgId: 'org-1', selection: 'org-2', orgs: ORGS }).orgId,
    'org-1',
  );
});

test('while the org list is loading nothing is asked of the admin yet', () => {
  // Without this the console flashes a picker before settling, and a caller
  // that treats "no orgId" as an error shows "Couldn't load" for a plain race.
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: null, orgs: null }),
    { orgId: null, needsPick: false, isResolving: true },
  );
});

test('a platform admin with one organisation is not made to pick it', () => {
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: null, orgs: [ORGS[0]] }),
    { orgId: 'org-1', needsPick: false, isResolving: false },
  );
});

test('a platform admin with several organisations is asked to choose one', () => {
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: null, orgs: ORGS }),
    { orgId: null, needsPick: true, isResolving: false },
  );
});

test('a remembered choice is reused across the console', () => {
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: 'org-2', orgs: ORGS }),
    { orgId: 'org-2', needsPick: false, isResolving: false },
  );
});

test('a choice the admin no longer holds is dropped, not replayed', () => {
  // Admin removed from org-2: sending the remembered id would fail
  // requireCapInOrg and the screen would read it as "Couldn't load".
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: 'org-9', orgs: ORGS }),
    { orgId: null, needsPick: true, isResolving: false },
  );
});

test('an empty organisation list is a real answer, not a race', () => {
  assert.deepEqual(
    resolveAdminOrgScope({ ownOrgId: null, selection: null, orgs: [] }),
    { orgId: null, needsPick: false, isResolving: false },
  );
});
