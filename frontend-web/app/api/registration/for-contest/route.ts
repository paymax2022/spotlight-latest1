// GET /api/registration/for-contest?contestId=<uuid>|contestSlug=<slug>
//
// Answers "does the signed-in user already have a live application here?" so a
// contest screen can offer "Manage your application" instead of a second
// "Apply" button. Deliberately mounted outside /applications/[id] so the static
// segment cannot be mistaken for an application id.
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { findLiveRegistrationForContest } from '@/src/server/registration-v2/registration-for-contest';

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const contestSlug = searchParams.get('contestSlug') || undefined;

    if (!contestId && !contestSlug) {
      return errorResponse('contestId or contestSlug is required', 400);
    }

    const registration = await findLiveRegistrationForContest(user.id, { contestId, contestSlug });

    return successResponse({ success: true, registration });
  } catch (error) {
    return handleApiError(error, 'Failed to look up registration for contest');
  }
}
