import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';
import { requireRequestUser } from '@/src/lib/auth/request';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { transactionId, paymentReference } = body;

  if (!transactionId || !paymentReference) {
    return errorResponse('transactionId and paymentReference are required', 400);
  }

  try {
    const user = await requireRequestUser(request);
    const ip = getIp(request);
    const userAgent = request.headers.get('user-agent') ?? '';

    const result = await bridgedVerifyPaidVote(
      { transactionId: transactionId as string, paymentReference: paymentReference as string },
      user.id,
      ip,
      userAgent,
    );

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
