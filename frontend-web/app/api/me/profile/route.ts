import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { calculateProfileCompletion, getOrCreateUserProfile, updateUserProfile } from '@/src/server/user/profile';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const profile = await getOrCreateUserProfile(user);
    return successResponse({ success: true, profile, completion: calculateProfileCompletion(profile) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return errorResponse('Authentication required', 401);
    return handleApiError(error, 'Failed to load profile');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);
    const profile = await updateUserProfile(user, body);
    return successResponse({ success: true, profile, completion: calculateProfileCompletion(profile) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return errorResponse('Authentication required', 401);
    return handleApiError(error, 'Failed to update profile');
  }
}
