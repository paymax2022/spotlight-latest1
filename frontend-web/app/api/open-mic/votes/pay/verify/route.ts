import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyVotePayment, resolveIdempotency } from '@/src/server/voting/core';
import { castVote, getContestById } from '@/src/server/openmic/persistence';
import {
  getOpenMicVoteIntentByReference,
  markOpenMicVoteIntent,
} from '@/src/server/payments/openmic-vote-intents';
import { createAdminClient } from '@/lib/supabase/server';

type OpenMicVerifyCached = { success: true; alreadyProcessed: true; newCount: number };

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json()) as {
      reference?: string;
      contestId?: string;
      submissionId?: string;
      votes?: number;
    };

    if (!body.reference)    return errorResponse('reference is required', 400);
    if (!body.contestId)    return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be > 0', 400);

    // If initiate recorded a charge intent for this reference it is
    // authoritative: the frozen params and server-quoted amount win over the
    // request body (AUD-FE-009). Intents are also payer-scoped — a reference
    // initiated by someone else cannot be claimed here.
    const intent = await getOpenMicVoteIntentByReference(body.reference);
    if (intent && intent.voter_user_id !== user.id) {
      return errorResponse('This payment reference belongs to a different account', 403);
    }
    const contestId = intent?.contest_id ?? body.contestId;
    const submissionId = intent?.submission_id ?? body.submissionId;
    const votes = intent?.votes ?? body.votes;
    let expectedKobo = intent?.amount_kobo ?? 0;
    if (!expectedKobo) {
      // Pre-intent in-flight reference: derive the quote server-side anyway
      // rather than trusting the body.
      const contest = await getContestById(contestId);
      const price = contest?.votingConfig?.votePrice ?? 0;
      expectedKobo = Math.round(votes * price * 100);
    }

    // Idempotency (shared core) — the durable dedup anchor is the Paystack
    // payment_reference, which is unique per payment and already persisted on
    // competition_entry_votes. The webhook path (and a redirect retry) can both
    // lands first the winner and any later call a safe no-op. Same helper that
    // v1/v2 use — only the storage table differs.
    const supabase = createAdminClient();
    const idem = await resolveIdempotency<OpenMicVerifyCached>(body.reference, {
      lookupCached: async (reference) => {
        const { data: existing } = await supabase
          .from('competition_entry_votes')
          .select('id, entry_id')
          .eq('payment_reference', reference)
          .maybeSingle();
        if (!existing) return null;
        const { data: entry } = await supabase
          .from('competition_entries')
          .select('public_vote_count')
          .eq('id', (existing as { entry_id?: string }).entry_id ?? submissionId)
          .maybeSingle();
        return {
          success: true,
          alreadyProcessed: true,
          newCount: Number((entry as { public_vote_count?: number } | null)?.public_vote_count ?? 0),
        };
      },
    });

    if (idem.status === 'cached') {
      if (intent && intent.status === 'pending') {
        await markOpenMicVoteIntent(body.reference, 'confirmed');
      }
      // instead of 409 so retries (and races with the webhook) are idempotent.
      return successResponse(idem.value);
    }

    // Verify payment with Paystack — vote is only cast if Paystack confirms success
    const result = await verifyVotePayment(body.reference);
    if (!result.success) {
      return errorResponse('Payment not confirmed — please contact support if funds were deducted', 402);
    }

    // AUD-FE-009: reconcile what Paystack actually collected against the
    // server-side quote. An under-collected charge must not mint votes.
    if (expectedKobo > 0 && result.amountKobo < expectedKobo) {
      if (intent && intent.status === 'pending') {
        await markOpenMicVoteIntent(
          body.reference,
          'amount_mismatch',
          `Paystack collected ${result.amountKobo} kobo, below the ${expectedKobo} kobo quote`,
        );
      }
      return errorResponse('Payment amount is below the required vote price', 402);
    }

    // Cast the vote. castVote inserts into competition_entry_votes keyed by
    // window between our check and here, the recompute-from-source-of-truth in
    // castVote keeps the count correct, and a duplicate-reference insert is
    // handled below as an already-processed result.
    let updated: { voteCount: number };
    try {
      updated = await castVote({
        contestId,
        submissionId,
        voterUserId: user.id,
        source: 'paid',
        votes,
        paymentReference: body.reference,
      });
    } catch (castErr) {
      // Race with the webhook: re-check whether the reference was credited
      // concurrently. If so, treat as idempotent success rather than an error.
      const { data: raced } = await supabase
        .from('competition_entry_votes')
        .select('entry_id')
        .eq('payment_reference', body.reference)
        .maybeSingle();
      if (raced) {
        const { data: entry } = await supabase
          .from('competition_entries')
          .select('public_vote_count')
          .eq('id', (raced as { entry_id?: string }).entry_id ?? submissionId)
          .maybeSingle();
        return successResponse({
          success: true,
          alreadyProcessed: true,
          newCount: Number((entry as { public_vote_count?: number } | null)?.public_vote_count ?? 0),
        });
      }
      throw castErr;
    }

    if (intent && intent.status === 'pending') {
      await markOpenMicVoteIntent(body.reference, 'confirmed');
    }

    return successResponse({ success: true, alreadyProcessed: false, newCount: updated.voteCount });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to verify payment and cast vote');
  }
}
