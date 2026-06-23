import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { castVote } from '@/src/server/openmic/persistence';
import { createAdminClient } from '@/lib/supabase/server';

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

    // Guard: reject if this reference was already used
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from('competition_entry_votes')
      .select('id')
      .eq('payment_reference', body.reference)
      .maybeSingle();
    if (existing) {
      return errorResponse('This payment reference has already been used', 409);
    }

    // Verify payment with Paystack — vote is only cast if Paystack confirms success
    const result = await verifyPaystackPayment(body.reference);
    if (!result.success) {
      return errorResponse('Payment not confirmed — please contact support if funds were deducted', 402);
    }

    // Cast the vote
    const updated = await castVote({
      contestId: body.contestId,
      submissionId: body.submissionId,
      voterUserId: user.id,
      source: 'paid',
      votes: body.votes,
      paymentReference: body.reference,
    });

    return successResponse({ success: true, newCount: updated.voteCount });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to verify payment and cast vote');
  }
}
