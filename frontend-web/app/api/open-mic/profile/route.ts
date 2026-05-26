import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { getRequestUserRole, requireRequestUser } from '@/src/lib/auth/request';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    const role = (await getRequestUserRole(user.id)) || 'participant';
    return successResponse({ success: true, profile: data || null, role, user });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load profile');
  }
}
