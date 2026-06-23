import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { randomUUID } from 'node:crypto';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json()) as {
      contestId?: string;
      submissionId?: string;
      stageName?: string;
      votes?: number;
      votePriceNgn?: number;
    };

    if (!body.contestId)    return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be > 0', 400);
    if (!body.votePriceNgn || body.votePriceNgn <= 0) return errorResponse('votePriceNgn required', 400);

    const reference = `om-vote-${randomUUID()}`;
    const amountNgn = body.votes * body.votePriceNgn;
    const amountKobo = amountNgn * 100;

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

    return successResponse({
      reference,
      amountKobo,
      amountNgn,
      email: user.email ?? '',
      publicKey,
      metadata: {
        contestId: body.contestId,
        submissionId: body.submissionId,
        stageName: body.stageName ?? '',
        votes: body.votes,
        votePriceNgn: body.votePriceNgn,
        userId: user.id,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to initiate payment');
  }
}
