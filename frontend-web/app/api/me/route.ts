import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getOrCreateUserProfile, calculateProfileCompletion } from '@/src/server/user/profile';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const profile = await getOrCreateUserProfile(user);
    const completion = calculateProfileCompletion(profile);
    return successResponse({ success: true, user, profile, completion });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load current user');
  }
}
