// Admin: which courses are currently being delivered under an audited pilot
// exception. Read-only here; enabling and revoking live on the course route.
// The exception never publishes or approves anything — see services/.../pilot.ts.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { loadPilotConsoleState } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'scores:manage');
    const supabase = createAdminClient();
    const state = await loadPilotConsoleState(supabase);
    return successResponse({ success: true, pilot: state });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load pilot delivery state');
  }
}
