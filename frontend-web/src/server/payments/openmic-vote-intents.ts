/**
 * Reference-keyed pending record for Open Mic paid-vote charges.
 *
 * POST /api/open-mic/votes/pay/initiate writes one row per minted reference so
 * that a Paystack-verified charge can be settled even when the client's verify
 * callback never arrives — the webhook gateway handler and
 * POST /api/v1/payments/gateway/recover both re-drive fulfilment through
 * src/server/payments/gateway-fulfil.ts.
 *
 * The row also freezes the SERVER-side quote (vote_price_ngn × votes) at
 * charge time: verify and fulfilment compare Paystack's confirmed amount
 * against amount_kobo, so a client-declared price can no longer set the
 * charge below the contest's configured vote price.
 *
 * Stores no money state — competition_entry_votes.payment_reference remains
 * the dedup anchor for the cast itself.
 */
import { createAdminClient } from '@/lib/supabase/server';

export type OpenMicVoteIntentStatus =
  | 'pending'
  | 'confirmed'
  | 'amount_mismatch'
  | 'failed';

export interface OpenMicVoteIntent {
  reference: string;
  contest_id: string;
  submission_id: string;
  voter_user_id: string;
  votes: number;
  amount_kobo: number;
  stage_name: string | null;
  status: OpenMicVoteIntentStatus;
}

export async function createOpenMicVoteIntent(input: {
  reference: string;
  contestId: string;
  submissionId: string;
  voterUserId: string;
  votes: number;
  amountKobo: number;
  stageName?: string;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('openmic_vote_paystack_intents').insert({
    reference: input.reference,
    contest_id: input.contestId,
    submission_id: input.submissionId,
    voter_user_id: input.voterUserId,
    votes: input.votes,
    amount_kobo: input.amountKobo,
    stage_name: input.stageName ?? null,
    status: 'pending',
  });
  if (error) throw error;
}

export async function getOpenMicVoteIntentByReference(
  reference: string,
): Promise<OpenMicVoteIntent | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('openmic_vote_paystack_intents')
    .select(
      'reference, contest_id, submission_id, voter_user_id, votes, amount_kobo, stage_name, status',
    )
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  return (data as OpenMicVoteIntent | null) ?? null;
}

export async function markOpenMicVoteIntent(
  reference: string,
  status: OpenMicVoteIntentStatus,
  failureReason?: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('openmic_vote_paystack_intents')
    .update({
      status,
      ...(status === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}),
      ...(failureReason ? { failure_reason: failureReason } : {}),
    })
    .eq('reference', reference);
  if (error) throw error;
}
