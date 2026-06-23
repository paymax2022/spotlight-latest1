import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';

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

    return successResponse({ ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to verify payment');
  }
}
