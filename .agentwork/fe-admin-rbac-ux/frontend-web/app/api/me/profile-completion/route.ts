import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { calculateProfileCompletion, getOrCreateUserProfile } from '@/src/server/user/profile';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const profile = await getOrCreateUserProfile(user);
    return successResponse({ success: true, completion: calculateProfileCompletion(profile) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return errorResponse('Authentication required', 401);
    return handleApiError(error, 'Failed to calculate profile completion');
  }
}
