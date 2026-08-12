import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { listRegistrationContests } from '@/src/server/registration/supabase-store';

export async function GET() {
  try {
    const contests = listRegistrationContests();
    return successResponse({ success: true, contests });
  } catch (error) {
    return handleApiError(error, 'Failed to load registration contests');
  }
}
