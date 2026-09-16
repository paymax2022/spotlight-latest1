// Proves the owner management screen never offers an action the server is
// certain to refuse, and never hides one it would accept.
//
// The two refusals the API states outright are the ones worth pinning: a
// campaign that has ever received funds cannot be deleted (409), and a feature
// request needs an ACTIVE campaign.
//
// The third thing pinned here is the orthogonality of `paused` and `status`.
// Pausing is a boolean beside the moderator's review status, NOT a value in it,
// so a campaign can be ACTIVE and paused at once — and a campaign frozen while
// paused must not offer its owner a Resume, which would amount to lifting a
// fraud stop. That is the regression this file exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// `@/` + extensionless, resolved by tests/unit/ts-path-hooks.mjs.
import {
  canDelete, canPause, canResume, canRequestFeature, canWithdrawFeatureRequest,
  canUnfeature, canWithdrawFunds, canEdit, hasReceivedFunds, featureRequestState,
  type OwnerCampaign,
} from '@/features/crowdfunding/utils/ownerCampaignActions';

const campaign = (over: Partial<OwnerCampaign> = {}): OwnerCampaign => ({
  status: 'ACTIVE',
  paused: false,
  raisedKobo: 0,
  contributorCount: 0,
  featured: false,
  ...over,
});

test('delete is refused once a campaign has received funds', () => {
  assert.equal(canDelete(campaign()).allowed, true);

  const funded = canDelete(campaign({ raisedKobo: 500_00, contributorCount: 1 }));
  assert.equal(funded.allowed, false);
  assert.match(funded.reason ?? '', /contributions/i);
});

test('a fully refunded campaign is still undeletable', () => {
  // Refunds can take raisedKobo back to zero while the contribution records
  // remain — the server keys off the record, so the UI must too.
  const refunded = campaign({ raisedKobo: 0, contributorCount: 7 });
  assert.equal(hasReceivedFunds(refunded), true);
  assert.equal(canDelete(refunded).allowed, false);
});

test('a frozen campaign offers no owner action that lifts the freeze', () => {
  const frozen = campaign({ status: 'FROZEN', raisedKobo: 10_00, contributorCount: 2, featured: true });
  assert.equal(canResume(frozen).allowed, false);
  assert.equal(canPause(frozen).allowed, false);
  assert.equal(canDelete(frozen).allowed, false);
  assert.equal(canEdit(frozen).allowed, false);
  assert.equal(canRequestFeature(frozen).allowed, false);
  assert.equal(canWithdrawFunds(frozen).allowed, false);
  // Coming OFF the featured rail stays available — that is the owner's own
  // placement and nothing about a freeze should trap them on the home screen.
  assert.equal(canUnfeature(frozen).allowed, true);
});

test('a campaign frozen WHILE PAUSED cannot be resumed by its owner', () => {
  // The whole reason pausing is not a status: if Resume keyed off the status
  // token it would have to write ACTIVE back over FROZEN, handing the creator a
  // one-tap undo of a fraud stop.
  const frozenWhilePaused = campaign({ status: 'FROZEN', paused: true });
  const gate = canResume(frozenWhilePaused);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason ?? '', /Trust & Safety/i);
});

test('pause and resume key off the boolean, not the status token', () => {
  // ACTIVE and unpaused: pausable, nothing to resume.
  assert.equal(canPause(campaign({ status: 'ACTIVE', paused: false })).allowed, true);
  assert.equal(canResume(campaign({ status: 'ACTIVE', paused: false })).allowed, false);

  // ACTIVE and paused — both true at once, which is the orthogonal case.
  assert.equal(canPause(campaign({ status: 'ACTIVE', paused: true })).allowed, false);
  assert.equal(canResume(campaign({ status: 'ACTIVE', paused: true })).allowed, true);

  // Pausing is meaningless anywhere the campaign is not live.
  for (const status of ['DRAFT', 'PENDING_REVIEW', 'COMPLETED', 'REJECTED'] as const) {
    assert.equal(canPause(campaign({ status })).allowed, false, `pause offered on ${status}`);
    assert.equal(canResume(campaign({ status })).allowed, false, `resume offered on ${status}`);
    // …and a paused campaign that has since completed has nothing to go back to.
    assert.equal(
      canResume(campaign({ status, paused: true })).allowed,
      false,
      `resume offered on paused ${status}`,
    );
  }
});

test('a feature request is offered only on a live, unfeatured campaign', () => {
  assert.equal(canRequestFeature(campaign({ status: 'ACTIVE' })).allowed, true);

  for (const status of ['DRAFT', 'PENDING_REVIEW', 'COMPLETED', 'REJECTED'] as const) {
    const gate = canRequestFeature(campaign({ status }));
    assert.equal(gate.allowed, false, `feature request offered on ${status}`);
    assert.ok(gate.reason, `no reason given for ${status}`);
  }

  assert.equal(canRequestFeature(campaign({ featured: true })).allowed, false);
  assert.equal(canRequestFeature(campaign({ featureRequestStatus: 'PENDING' })).allowed, false);
});

test('withdrawing a feature request needs a pending one', () => {
  assert.equal(canWithdrawFeatureRequest(campaign({ featureRequestStatus: 'PENDING' })).allowed, true);
  assert.equal(canWithdrawFeatureRequest(campaign()).allowed, false);
  assert.equal(canWithdrawFeatureRequest(campaign({ featured: true })).allowed, false);
});

test('feature state falls back to `featured` when the server omits it', () => {
  // The public payload carries no featureRequestStatus. Inferring APPROVED from
  // `featured` is the only thing that flag actually proves.
  assert.equal(featureRequestState(campaign({ featured: true })), 'APPROVED');
  assert.equal(featureRequestState(campaign({ featured: false })), 'NONE');
  // An explicit value always wins over the inference.
  assert.equal(featureRequestState(campaign({ featured: true, featureRequestStatus: 'PENDING' })), 'PENDING');
});

test('withdrawing funds needs funds', () => {
  assert.equal(canWithdrawFunds(campaign()).allowed, false);
  assert.equal(canWithdrawFunds(campaign({ raisedKobo: 1, contributorCount: 1 })).allowed, true);
});

test('editing is closed once the funding run is over', () => {
  assert.equal(canEdit(campaign({ status: 'ACTIVE' })).allowed, true);
  assert.equal(canEdit(campaign({ status: 'ACTIVE', paused: true })).allowed, true);
  assert.equal(canEdit(campaign({ status: 'DRAFT' })).allowed, true);
  for (const status of ['COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED'] as const) {
    assert.equal(canEdit(campaign({ status })).allowed, false, `edit offered on ${status}`);
  }
});
