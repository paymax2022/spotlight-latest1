import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { castVote } from '@/src/server/openmic/persistence';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contestId?: string;
      submissionId?: string;
      voterUserId?: string;
      voterName?: string;
      source?: 'free' | 'paid' | 'bundle' | 'bonus';
      votes?: number;
      paymentReference?: string;
    };

    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!body.source) return errorResponse('source is required', 400);
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be greater than 0', 400);

    const submission = await castVote({
      contestId: body.contestId,
      submissionId: body.submissionId,
      voterUserId: body.voterUserId,
      voterName: body.voterName,
      source: body.source,
      votes: body.votes,
      paymentReference: body.paymentReference,
    });

    return successResponse({ success: true, submission });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}

