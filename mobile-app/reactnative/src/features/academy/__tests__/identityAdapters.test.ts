// Unit tests for the identity /me adapter (nested Go aggregate → flat
// AcademyProfile), pinned against the real /me shape. Run: npm run test:academy
//
// The mobile screens code against a flat AcademyProfile; the Go /me returns
// {user_id, roles[], profiles[], guardian_links[], guarded_by[]}. adaptMe bridges
// them: role/kyc mapping, class_id→classCode resolution, guardian-consent
// derivation, and onboardingComplete inference — so profile state can go live
// (and persist across launches) without regressing the minor-consent gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptMe, mapGoRole, mapMobileRole, kycFromInt, kycToInt, deriveConsent } from '../identityAdapters.ts';

const classMap = new Map([['cls-uuid-1', 'JSS1']]);

const GO_ME_ONBOARDED = {
  user_id: 'u1',
  roles: [{ user_id: 'u1', role: 'learner' }],
  profiles: [{
    id: 'p1', user_id: 'u1', role: 'learner', class_id: 'cls-uuid-1', stream: 'science',
    display_name: 'Ada', dob: '2012-05-01', is_minor: true, kyc_tier: 1, entry_year: 2024,
  }],
  guardian_links: [],
  guarded_by: [{ guardian_user_id: 'g1', minor_user_id: 'u1', status: 'active' }],
};

test('adaptMe maps a full profile (class resolved, minor, consent granted)', () => {
  const p = adaptMe(GO_ME_ONBOARDED, classMap);
  assert.equal(p.id, 'p1');
  assert.equal(p.role, 'learner');
  assert.equal(p.displayName, 'Ada');
  assert.equal(p.dob, '2012-05-01');
  assert.equal(p.isMinor, true);
  assert.equal(p.kycTier, 'tier1');
  assert.equal(p.classCode, 'JSS1', 'class_id resolved to code');
  assert.equal(p.stream, 'science');
  assert.equal(p.guardianConsent, 'granted', 'minor + active guardian link → granted');
  assert.equal(p.guardianId, 'g1');
  assert.equal(p.onboardingComplete, true, 'role + class set → onboarded');
});

test('no profile → not-onboarded defaults (never a minor by default, consent not_required)', () => {
  const p = adaptMe({ user_id: 'u1', roles: [], profiles: [], guardian_links: [], guarded_by: [] }, classMap);
  assert.equal(p.id, 'u1');
  assert.equal(p.onboardingComplete, false);
  assert.equal(p.isMinor, false);
  assert.equal(p.guardianConsent, 'not_required');
});

test('consent derivation (fail-safe): minor without an active link → pending', () => {
  assert.equal(deriveConsent([{ guardian_user_id: 'g', minor_user_id: 'm', status: 'pending' }], true), 'pending');
  assert.equal(deriveConsent([], true), 'pending');
  assert.equal(deriveConsent([{ guardian_user_id: 'g', minor_user_id: 'm', status: 'active' }], true), 'granted');
  assert.equal(deriveConsent([], false), 'not_required');
});

test('onboardingComplete requires BOTH role and class', () => {
  const noClass = adaptMe({ ...GO_ME_ONBOARDED, profiles: [{ ...GO_ME_ONBOARDED.profiles[0], class_id: null }] }, classMap);
  assert.equal(noClass.onboardingComplete, false);
  assert.equal(noClass.classCode, undefined);
});

test('role + kyc mappings (backend ↔ mobile)', () => {
  assert.equal(mapGoRole('learner'), 'learner');
  assert.equal(mapGoRole('parent'), 'parent');
  assert.equal(mapGoRole('staff'), 'tutor', 'backend staff has no mobile equivalent → tutor');
  assert.equal(mapMobileRole('kid'), 'learner', 'mobile kid → backend learner');
  assert.equal(mapMobileRole('parent'), 'parent');
  assert.equal(kycFromInt(0), 'tier0');
  assert.equal(kycFromInt(2), 'tier2');
  assert.equal(kycToInt('tier1'), 1);
});
