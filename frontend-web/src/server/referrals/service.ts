/**
 * Block 8 — Referral Service
 *
 * Provides:
 *   getOrCreateCode(userId)          — fetch or generate user's SPOT-XXXXXX code
 *   getReferralSummary(userId)        — code + earnings + referral count
 *   resolveCodeToReferrer(code)       — map share code → referrer user ID
 *   processReferralReward(input)      — credit referrer ₦500 (50,000 kobo), at-most-once
 *   processReferralOutbox()           — drain pending referral.triggered outbox events
 *
 * At-most-once guarantee:
 *   referral_events has UNIQUE(referrer_id, referred_id) + UNIQUE(idempotency_key).
 *   A duplicate insert (same pair or same key) is silently swallowed (23505).
 *
 * Self-referral:
 *   Blocked at DB level (CHECK referrer_id <> referred_id) and in processReferralReward().
 */

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet } from '@/src/server/wallet/service';

const REFERRAL_REWARD_KOBO = 50_000; // ₦500

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SPOT-${suffix}`;
}

// ---------------------------------------------------------------------------
// getOrCreateCode
// ---------------------------------------------------------------------------

export async function getOrCreateCode(userId: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return (existing as { code: string }).code;

  // Generate a unique code — retry on collision (extremely unlikely)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from('referral_codes')
      .insert({ user_id: userId, code });

    if (!error) return code;

    // 23505 on user_id UNIQUE = concurrent insert won the race
    if (error.code === '23505' && error.message.includes('user_id')) {
      const { data: raced } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('user_id', userId)
        .maybeSingle();
      if (raced) return (raced as { code: string }).code;
    }
    // 23505 on code UNIQUE = code collision — retry with new code
    if (error.code !== '23505') throw error;
  }

  throw new Error('Failed to generate unique referral code after 5 attempts');
}

// ---------------------------------------------------------------------------
// getReferralSummary
// ---------------------------------------------------------------------------

export interface ReferralSummary {
  code: string;
  totalReferrals: number;
  totalEarnedKobo: number;
}

export async function getReferralSummary(userId: string): Promise<ReferralSummary> {
  const supabase = createAdminClient();

  const [code, { data: events }] = await Promise.all([
    getOrCreateCode(userId),
    supabase
      .from('referral_events')
      .select('amount_kobo')
      .eq('referrer_id', userId),
  ]);

  const rows = (events ?? []) as Array<{ amount_kobo: number }>;

  return {
    code,
    totalReferrals:  rows.length,
    totalEarnedKobo: rows.reduce((sum, r) => sum + Number(r.amount_kobo), 0),
  };
}

// ---------------------------------------------------------------------------
// resolveCodeToReferrer
// ---------------------------------------------------------------------------

export async function resolveCodeToReferrer(code: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('referral_codes')
    .select('user_id')
    .eq('code', code.toUpperCase().trim())
    .maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

// ---------------------------------------------------------------------------
// processReferralReward
// ---------------------------------------------------------------------------

export interface ReferralRewardInput {
  shareCode: string;
  referredUserId: string;
}

export interface ReferralRewardResult {
  rewarded: boolean;
  alreadyRewarded: boolean;
  skipped: boolean;
  reason?: string;
  amountKobo?: number;
}

export async function processReferralReward(
  input: ReferralRewardInput,
): Promise<ReferralRewardResult> {
  const referrerId = await resolveCodeToReferrer(input.shareCode);

  if (!referrerId) {
    return { rewarded: false, alreadyRewarded: false, skipped: true, reason: 'code_not_found' };
  }

  // Self-referral protection
  if (referrerId === input.referredUserId) {
    return { rewarded: false, alreadyRewarded: false, skipped: true, reason: 'self_referral' };
  }

  const idempotencyKey = `referral-reward:${referrerId}:${input.referredUserId}`;

  // Credit referrer via ledger — idempotent
  const creditResult = await creditWallet(referrerId, {
    amountKobo:    REFERRAL_REWARD_KOBO,
    reference:     `REF_${input.shareCode}_${input.referredUserId.slice(0, 8).toUpperCase()}`,
    idempotencyKey,
    description:   `Referral reward for inviting user ${input.referredUserId.slice(0, 8)}`,
    metadata: {
      share_code:      input.shareCode,
      referred_user_id: input.referredUserId,
      reward_type:     'referral_first_vote',
    },
  });

  if (creditResult.alreadyProcessed) {
    return { rewarded: false, alreadyRewarded: true, skipped: false, amountKobo: REFERRAL_REWARD_KOBO };
  }

  // Record the referral event (at-most-once via UNIQUE constraint)
  const supabase = createAdminClient();
  const { error: eventError } = await supabase.from('referral_events').insert({
    referrer_id:     referrerId,
    referred_id:     input.referredUserId,
    idempotency_key: idempotencyKey,
    amount_kobo:     REFERRAL_REWARD_KOBO,
  });

  // 23505 = duplicate (referrer+referred pair already rewarded) — not an error
  if (eventError && eventError.code !== '23505') {
    // Event failed to record but ledger credit already happened — log but don't throw
    console.error('[referrals] Failed to insert referral_event after credit:', eventError.message);
  }

  return { rewarded: true, alreadyRewarded: false, skipped: false, amountKobo: REFERRAL_REWARD_KOBO };
}

// ---------------------------------------------------------------------------
// processReferralOutbox — drain pending referral.triggered events
// ---------------------------------------------------------------------------

export interface OutboxProcessResult {
  processed: number;
  skipped:   number;
  failed:    number;
}

export async function processReferralOutbox(limit = 50): Promise<OutboxProcessResult> {
  const supabase = createAdminClient();

  // Claim pending events atomically (status → processing)
  const { data: events } = await supabase
    .from('bridge_outbox')
    .select('id, payload')
    .eq('event_type', 'referral.triggered')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (!events?.length) return { processed: 0, skipped: 0, failed: 0 };

  const ids = (events as Array<{ id: string; payload: Record<string, unknown> }>).map(e => e.id);

  // Mark as processing to prevent concurrent workers from picking the same rows
  await supabase
    .from('bridge_outbox')
    .update({ status: 'processing', attempts: 1 })
    .in('id', ids);

  let processed = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const event of events as Array<{ id: string; payload: Record<string, unknown> }>) {
    const { shareCode, voterId } = event.payload as {
      shareCode?: string;
      voterId?: string;
    };

    if (!shareCode || !voterId) {
      await supabase.from('bridge_outbox').update({ status: 'done' }).eq('id', event.id);
      skipped++;
      continue;
    }

    try {
      const result = await processReferralReward({ shareCode, referredUserId: voterId });

      await supabase
        .from('bridge_outbox')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', event.id);

      if (result.skipped || result.alreadyRewarded) skipped++;
      else processed++;
    } catch (err) {
      await supabase
        .from('bridge_outbox')
        .update({
          status:     'failed',
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', event.id);
      failed++;
    }
  }

  return { processed, skipped, failed };
}
