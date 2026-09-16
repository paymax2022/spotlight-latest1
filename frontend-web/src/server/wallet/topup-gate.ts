/**
 * KYC gate for wallet top-ups (ADR-042).
 *
 * Two purposes, two gates:
 *
 *   'wallet'   — standalone funding from the wallet screen. Unchanged: Tier 1.
 *   'checkout' — raised by a module checkout's card rail (ADR-041), where the
 *                credit exists to be spent on the purchase that raised it. May be
 *                permitted below Tier 1, but only under a capped rolling
 *                allowance, and only when FEATURE_CHECKOUT_TOPUP_TIER0 is on.
 *
 * Why relaxing this is bounded rather than open: an unverified account cannot get
 * the money back OUT. Both payout paths — bank transfer and wallet-to-wallet —
 * call enforceWalletLimit, which hard-denies Tier 0 ("Wallet is disabled for
 * unverified accounts"). So a checkout top-up can only ever be spent on in-app
 * goods and services, never cashed out. The residual exposure is a refunded
 * purchase leaving in-app spendable balance, which the allowance caps.
 *
 * Every decision here fails closed and is written to tier_limit_events.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { getKycTier } from '@/src/server/kyc/service';
import { requireKycTier } from '@/src/server/kyc/gate';
import { ApiError } from '@/src/lib/api/responses';
import { featureFlags } from '@/src/lib/feature-flags';
import type { KycTier } from '@/src/server/kyc/types';

export type TopupPurpose = 'wallet' | 'checkout';

/** The tier a standalone wallet funding has always required. */
export const STANDALONE_TOPUP_TIER: KycTier = 1;

/**
 * Rolling-window allowance for checkout top-ups, per tier, in kobo.
 *
 * Tier 0 is the whole point of this table: unverified accounts get a small
 * allowance so they can pay by card at checkout, instead of being refused
 * outright. Tiers 1+ already clear the standalone gate, so they are unbounded
 * HERE — their spending is bounded by the ordinary wallet daily limits.
 *
 * The Tier-0 figure is deliberately conservative and is a COMPLIANCE parameter,
 * not an engineering one. Changing it changes how much value an unverified
 * account can move into the platform per day.
 */
export const CHECKOUT_TOPUP_ALLOWANCE_KOBO: Record<KycTier, number | null> = {
  0: 2_000_000,  // ₦20,000 per rolling 24h
  1: null,       // unbounded here — ordinary wallet limits apply
  2: null,
  3: null,
};

/** Largest single checkout top-up an unverified account may raise. */
export const CHECKOUT_TOPUP_MAX_SINGLE_KOBO = 1_000_000; // ₦10,000

export const CHECKOUT_ALLOWANCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TopupGateResult {
  tier: KycTier;
  /** Remaining checkout allowance in kobo after this top-up; null = unbounded. */
  remainingAllowanceKobo: number | null;
}

/**
 * Sum the checkout top-ups a user has raised inside the rolling window.
 *
 * Counts 'pending' as well as 'completed'. A pending intent is money the user has
 * very likely already been charged for — the webhook simply has not landed yet —
 * so excluding it would let a burst of concurrent checkouts each see a fresh
 * allowance and blow straight through the cap.
 */
async function usedAllowanceKobo(userId: string, sinceISO: string): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallet_topup_intents')
    .select('amount_kobo')
    .eq('user_id', userId)
    .eq('purpose', 'checkout')
    .in('status', ['pending', 'completed'])
    .gte('created_at', sinceISO);

  // Fail closed: an unreadable history means we cannot prove the cap is intact.
  if (error) throw new ApiError('Could not verify your payment allowance. Please try again.', 503);

  return (data ?? []).reduce((sum, r) => sum + Number((r as { amount_kobo: number }).amount_kobo ?? 0), 0);
}

/**
 * Authorise a top-up of `amountKobo` for `purpose`, or throw.
 *
 * Returns the caller's tier and what is left of their checkout allowance, so the
 * route can surface it.
 */
export async function assertTopupAllowed(
  userId: string,
  amountKobo: number,
  purpose: TopupPurpose,
  now: () => number = Date.now,
): Promise<TopupGateResult> {
  // Standalone funding, or the relaxation switched off: the original gate, verbatim.
  // The flag defaulting to off means this file changes nothing until it is turned on.
  if (purpose !== 'checkout' || !featureFlags.checkoutTopupTier0()) {
    await requireKycTier(userId, STANDALONE_TOPUP_TIER);
    return { tier: await readTier(userId), remainingAllowanceKobo: null };
  }

  const tier = await readTier(userId);
  const allowance = CHECKOUT_TOPUP_ALLOWANCE_KOBO[tier];

  // Tiers that already clear the standalone gate are not additionally capped here.
  if (allowance === null) {
    return { tier, remainingAllowanceKobo: null };
  }

  // Single-transaction ceiling. Checked before the window sum so an obviously
  // oversized request is refused without a history read.
  if (amountKobo > CHECKOUT_TOPUP_MAX_SINGLE_KOBO) {
    await recordCheckoutEvent(userId, tier, amountKobo, CHECKOUT_TOPUP_MAX_SINGLE_KOBO, true);
    throw new ApiError(
      `Card payments are limited to ₦${CHECKOUT_TOPUP_MAX_SINGLE_KOBO / 100} per purchase until you verify your identity.`,
      403,
    );
  }

  const sinceISO = new Date(now() - CHECKOUT_ALLOWANCE_WINDOW_MS).toISOString();
  const used = await usedAllowanceKobo(userId, sinceISO);

  if (used + amountKobo > allowance) {
    await recordCheckoutEvent(userId, tier, amountKobo, allowance, true, used);
    throw new ApiError(
      `You have reached the ₦${allowance / 100} daily card limit for unverified accounts. ` +
      'Complete identity verification to raise it.',
      403,
    );
  }

  await recordCheckoutEvent(userId, tier, amountKobo, allowance, false, used);
  return { tier, remainingAllowanceKobo: allowance - used - amountKobo };
}

async function readTier(userId: string): Promise<KycTier> {
  try {
    return await getKycTier(userId);
  } catch {
    // Fail closed — an unknown tier is not a permitted tier.
    throw new ApiError('KYC verification check failed. Access denied.', 403);
  }
}

async function recordCheckoutEvent(
  userId: string,
  tier: KycTier,
  amountKobo: number,
  limitKobo: number,
  denied: boolean,
  usedKobo?: number,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('tier_limit_events').insert({
      user_id: userId,
      tier,
      limit_type: 'checkout_topup',
      amount_kobo: amountKobo,
      daily_total_kobo: usedKobo ?? null,
      limit_kobo: limitKobo,
      denied,
    });
  } catch {
    // Audit write failures must not block the enforcement path.
  }
}
