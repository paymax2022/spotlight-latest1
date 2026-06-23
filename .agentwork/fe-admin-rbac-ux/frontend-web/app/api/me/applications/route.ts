import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { listUserApplications, summarizeApplications } from '@/src/server/user/hub';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const applications = await listUserApplications(user);
    return successResponse({ success: true, applications, summary: summarizeApplications(applications) });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return errorResponse('Authentication required', 401);
    return handleApiError(error, 'Failed to load user applications');
  }
}
