import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyVotePayment, resolveIdempotency } from '@/src/server/voting/core';
import { castVote } from '@/src/server/openmic/persistence';
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

    // Idempotency (shared core) — the durable dedup anchor is the Paystack
    // payment_reference, which is unique per payment and already persisted on
    // competition_entry_votes. The webhook path (and a redirect retry) can both
    // arrive for the same payment; keying off payment_reference makes whichever
    // lands first the winner and any later call a safe no-op. Same helper that
    // v1/v2 use — only the storage table differs.
    const supabase = createAdminClient();
    const submissionId = body.submissionId;
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
      // Already credited for this reference — return 200 with the current count
      // instead of 409 so retries (and races with the webhook) are idempotent.
      return successResponse(idem.value);
    }

    // Verify payment with Paystack — vote is only cast if Paystack confirms success
    const result = await verifyVotePayment(body.reference);
    if (!result.success) {
      return errorResponse('Payment not confirmed — please contact support if funds were deducted', 402);
    }

    // Cast the vote. castVote inserts into competition_entry_votes keyed by
    // payment_reference; if the webhook processed this same payment in the
    // window between our check and here, the recompute-from-source-of-truth in
    // castVote keeps the count correct, and a duplicate-reference insert is
    // handled below as an already-processed result.
    let updated: { voteCount: number };
    try {
      updated = await castVote({
        contestId: body.contestId,
        submissionId: body.submissionId,
        voterUserId: user.id,
        source: 'paid',
        votes: body.votes,
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
          .eq('id', (raced as { entry_id?: string }).entry_id ?? body.submissionId)
          .maybeSingle();
        return successResponse({
          success: true,
          alreadyProcessed: true,
          newCount: Number((entry as { public_vote_count?: number } | null)?.public_vote_count ?? 0),
        });
      }
      throw castErr;
    }

    return successResponse({ success: true, alreadyProcessed: false, newCount: updated.voteCount });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to verify payment and cast vote');
  }
}
