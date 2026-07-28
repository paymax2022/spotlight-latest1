// ── Referral foundation types ────────────────────────────────────────────────
// Self-contained types for the mobile foundation (onboarding, attribution,
// grace window, roles/context, notification prefs, account/fraud standing).
// Money is ALWAYS integer kobo. The server is the source of truth.

import type { EarnStateKey, ReferralRole } from '../constants/referral.constants';

export type { EarnStateKey, ReferralRole };

// ── Attribution (§7A) ────────────────────────────────────────────────────────
export type AttributionType =
  | 'code'
  | 'deeplink'
  | 'context'
  | 'regional_house'
  | 'global_house';

export type AttributionStatus = 'grace' | 'locked' | 'unattributed';

export interface AttributionState {
  /** Who the new user is currently attributed to (display name), null if house. */
  referrerName: string | null;
  attributionType: AttributionType;
  /** True when the referrer side currently resolves to the house/Super-Admin. */
  isHouse: boolean;
  status: AttributionStatus;
  /** ISO timestamp; only meaningful while status === 'grace'. */
  graceExpiresAt: string | null;
  /** Code the user originally signed up with, if any. */
  codeUsed: string | null;
}

// Resolving a code (inline validation in M-ONB-10 / M-INV-10).
export interface CodeResolution {
  valid: boolean;
  /** Referrer display name when valid. */
  referrerName?: string;
  /** Reason when invalid: helps surface "check code" vs self-referral copy. */
  reason?: 'not_found' | 'expired' | 'self_referral' | 'suspended';
}

// attributeSignup result (M-ONB-10 submit).
export interface AttributeSignupResult {
  attribution: AttributionState;
  /** True when a blank/invalid code routed silently to the house default. */
  routedToHouse: boolean;
}

// Late-claim result (M-INV-10 submit).
export interface ClaimCodeResult {
  ok: boolean;
  attribution?: AttributionState;
  error?: 'invalid' | 'window_closed' | 'self_referral' | 'already_claimed';
}

// ── Role / context (M-ONB-09) ────────────────────────────────────────────────
export interface RoleContext {
  /** Roles the user currently holds (always includes 'referrer'). */
  available: ReferralRole[];
  active: ReferralRole;
  /** Roles that require step-up verification before they can be activated. */
  lockedUntilVerified: ReferralRole[];
}

// ── Notification preferences (M-NOT-01 / M-ACC-04) ───────────────────────────
export type NotificationChannel = 'push' | 'email' | 'sms';

export interface NotificationPrefs {
  signup: boolean;
  activation: boolean;
  reward: boolean;
  vestingUnlock: boolean;
  payout: boolean;
  clawback: boolean;
  rankUp: boolean;
  channels: Record<NotificationChannel, boolean>;
}

export type ReferralNotificationType =
  | 'signup'
  | 'activation'
  | 'reward'
  | 'vesting_unlock'
  | 'payout'
  | 'clawback'
  | 'rank_up';

export interface ReferralNotification {
  id: string;
  type: ReferralNotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Optional reward amount in kobo for reward/payout/clawback rows. */
  amountKobo?: number | null;
}

// ── Account / fraud standing (M-ACC-01) ──────────────────────────────────────
export type StandingLevel = 'good' | 'review' | 'restricted' | 'suspended';

export interface FraudFlag {
  id: string;
  label: string;
  detail: string;
  severity: 'info' | 'warn' | 'danger';
  /** Actionable fix copy, when the user can resolve it themselves. */
  fix?: string;
}

export interface AccountStanding {
  level: StandingLevel;
  /** KYC tier (0..3) — mirrors finance tiers for display only. */
  kycTier: number;
  flags: FraudFlag[];
  /** Lifetime earned vs currently withheld (kobo) for the standing summary. */
  earnedKobo: number;
  withheldKobo: number;
}

// ── Contacts / disclosure consent (M-ONB-03 / M-ONB-04) ──────────────────────
export interface ConsentState {
  termsAcceptedAt: string | null;
  contactsConsentAt: string | null;
  nudgesConsentAt: string | null;
}
