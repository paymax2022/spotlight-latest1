// ── Crowdfunding — owner self-management gates ───────────────────────────────
//
// The owner management screen must never offer an action the server is certain
// to refuse: a tap that can only ever come back as a 409 is a worse experience
// than a disabled control that says why. These predicates encode the refusals
// the API contract states outright (delete needs a campaign that never received
// funds; a feature request needs an ACTIVE campaign) plus the ones that are
// structurally impossible (resume a campaign that is not paused, an owner
// lifting a Trust & Safety freeze).
//
// They are deliberately pure and campaign-shaped so the screen and any test can
// share one definition, and so the reason string that gates a control is the
// same string the UI renders. Gating is NOT a substitute for handling a server
// refusal — the screen still renders whatever error arrives.

import type { Campaign, CampaignStatus } from '../types/crowdfunding.types';

/** Fields the gates need — a subset so callers can pass a list row. */
export type OwnerCampaign = Pick<
  Campaign,
  'status' | 'raisedKobo' | 'contributorCount' | 'featured'
> & Partial<Pick<Campaign, 'featureRequestStatus'>>;

export interface ActionGate {
  allowed: boolean;
  /** Why the action is unavailable. Rendered next to the disabled control. */
  reason?: string;
}

const ALLOW: ActionGate = { allowed: true };
const deny = (reason: string): ActionGate => ({ allowed: false, reason });

/** Frozen is a moderation lock: only Trust & Safety can lift it. */
const FROZEN_REASON = 'This campaign is frozen by Trust & Safety. Contact support to have it reviewed.';

/** Statuses where the campaign's funding run is over for good. */
const TERMINAL: CampaignStatus[] = ['COMPLETED', 'EXPIRED', 'CANCELLED'];

/**
 * Has this campaign ever taken money? The delete contract keys off exactly this
 * — a campaign with contributions has ledger history that must survive, so the
 * server answers a delete with 409. Checking BOTH the amount and the backer
 * count matters: a fully refunded campaign can be back at ₦0 raised while still
 * having contributor records behind it.
 */
export function hasReceivedFunds(c: OwnerCampaign): boolean {
  return c.raisedKobo > 0 || c.contributorCount > 0;
}

/**
 * Effective feature-request state.
 *
 * `featureRequestStatus` is optional on the wire. When it is missing we infer
 * only what `featured` proves — that an approved request exists — and otherwise
 * report NONE. The consequence is documented at the call site: a request that
 * the server has queued but does not report back would let the owner ask twice.
 * That re-request is answered by the server, not silently swallowed here.
 */
export function featureRequestState(c: OwnerCampaign): 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' {
  if (c.featureRequestStatus) return c.featureRequestStatus;
  return c.featured ? 'APPROVED' : 'NONE';
}

export function canEdit(c: OwnerCampaign): ActionGate {
  if (c.status === 'FROZEN') return deny(FROZEN_REASON);
  if (TERMINAL.includes(c.status)) return deny('This campaign has finished. Its details can no longer be changed.');
  if (c.status === 'REJECTED') return deny('Rejected campaigns cannot be edited. Start a new campaign instead.');
  return ALLOW;
}

export function canPause(c: OwnerCampaign): ActionGate {
  if (c.status === 'ACTIVE') return ALLOW;
  if (c.status === 'PAUSED') return deny('Already paused.');
  if (c.status === 'FROZEN') return deny(FROZEN_REASON);
  return deny('Only a live campaign can be paused.');
}

export function canResume(c: OwnerCampaign): ActionGate {
  if (c.status === 'PAUSED') return ALLOW;
  if (c.status === 'FROZEN') return deny(FROZEN_REASON);
  return deny('This campaign is not paused.');
}

export function canDelete(c: OwnerCampaign): ActionGate {
  if (hasReceivedFunds(c)) {
    return deny(
      'This campaign has received contributions, so it cannot be deleted — the contribution record has to be kept. Pause it to take it off discovery instead.',
    );
  }
  if (c.status === 'FROZEN') return deny(FROZEN_REASON);
  return ALLOW;
}

export function canRequestFeature(c: OwnerCampaign): ActionGate {
  const state = featureRequestState(c);
  if (state === 'PENDING') return deny('A feature request is already with the admin team.');
  if (c.featured) return deny('This campaign is already featured.');
  if (c.status !== 'ACTIVE') {
    return deny(
      c.status === 'FROZEN'
        ? FROZEN_REASON
        : 'Only a live campaign can be featured. This one is not active.',
    );
  }
  return ALLOW;
}

export function canWithdrawFeatureRequest(c: OwnerCampaign): ActionGate {
  return featureRequestState(c) === 'PENDING' ? ALLOW : deny('No feature request is pending.');
}

/** Removing your own campaign from the rail is always permitted while featured. */
export function canUnfeature(c: OwnerCampaign): ActionGate {
  return c.featured ? ALLOW : deny('This campaign is not featured.');
}

export function canWithdrawFunds(c: OwnerCampaign): ActionGate {
  if (c.status === 'FROZEN') return deny(FROZEN_REASON);
  if (!hasReceivedFunds(c)) return deny('There is nothing to withdraw yet.');
  return ALLOW;
}
