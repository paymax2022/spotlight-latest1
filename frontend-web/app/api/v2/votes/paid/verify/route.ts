/**
 * POST /api/v2/votes/paid/verify — card/Paystack verification, plus the connect
 * tally mirror.
 *
 * Same contract as /api/votes/paid/verify: { transactionId, paymentReference }.
 * It exists as a v2 route rather than a change to the v1 one because
 * app/api/votes/paid/verify/route.ts is brownfield-protected. Per the
 * vote-bridge skill, the protected work is IMPORTED and called unchanged; the
 * new behaviour sits beside it.
 *
 * The added behaviour is the same one the wallet route needed: a credited
 * purchase must also land in connect_votes, the plane Go's ListRoster sums for
 * the mobile roster and leaderboard. Without it the card path repeats the wallet
 * bug — payment taken, "votes credited", displayed count unchanged.
 *
 * Idempotent on the payment reference, which matters more here than on the
 * wallet path: a Paystack webhook and the browser redirect can both verify the
 * same transaction, and only one of them may count.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';
import { mirrorPaidVoteToConnect } from '@/src/server/voting-bridge/connect-tally';
import { createAdminClient } from '@/lib/supabase/server';

async function tryGetUserId(request: Request): Promise<string> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return 'anonymous';
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id ?? 'anonymous';
  } catch {
    return 'anonymous';
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { transactionId?: string; paymentReference?: string };
    if (!body.transactionId) return errorResponse('transactionId is required', 400);
    if (!body.paymentReference) return errorResponse('paymentReference is required', 400);

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '0.0.0.0';
    const ua = request.headers.get('user-agent') || '';
    const actorId = await tryGetUserId(request);

    const result = await verifyAndCreditPaidVote(
      { transactionId: body.transactionId, paymentReference: body.paymentReference },
      actorId,
      ip,
      ua,
    );

    // Read the transaction back rather than trusting the request body for who and
    // how much: the row is what the credit was actually computed from, and the
    // caller does not send the contestant, the quantity or the buyer at all.
    const supabase = createAdminClient();
    const { data: tx } = await supabase
      .from('vote_transactions')
      .select('contest_id, contestant_id, voter_user_id, total_votes_to_credit, amount_expected, vote_credit_status')
      .eq('id', body.transactionId)
      .maybeSingle();

    const row = tx as {
      contest_id: string;
      contestant_id: string;
      voter_user_id: string | null;
      total_votes_to_credit: number;
      amount_expected: number;
      vote_credit_status: string;
    } | null;

    // Only mirror a purchase that actually credited. A pending or failed
    // verification must not put votes on the roster.
    if (row && row.vote_credit_status === 'credited' && row.voter_user_id) {
      const mirrored = await mirrorPaidVoteToConnect({
        contestId: row.contest_id,
        contestantId: row.contestant_id,
        voterUserId: row.voter_user_id,
        quantity: Number(row.total_votes_to_credit ?? 0),
        // amount_expected is NAIRA on vote_transactions (same unit as
        // vote_packages.amount); connect_votes.amount_kobo is minor units.
        amountKobo: Math.round(Number(row.amount_expected ?? 0) * 100),
        reference: body.paymentReference,
      });
      if (!mirrored.recorded && mirrored.reason !== 'already_recorded') {
        console.error(
          '[v2 votes/paid/verify] connect tally mirror skipped — the buyer will not see these votes.',
          { paymentReference: body.paymentReference, reason: mirrored.reason, error: mirrored.error },
        );
      }
    } else if (row && !row.voter_user_id) {
      // Anonymous card purchases cannot be mirrored: connect_votes.voter_id is
      // NOT NULL and FKs auth.users. Worth knowing about rather than silently
      // dropping — these buyers see no vote movement.
      console.warn(
        '[v2 votes/paid/verify] purchase has no voter_user_id; connect tally cannot record it.',
        { paymentReference: body.paymentReference },
      );
    }

    return successResponse({ ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to verify payment');
  }
}
