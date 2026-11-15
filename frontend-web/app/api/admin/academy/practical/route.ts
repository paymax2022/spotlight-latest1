// Admin: every configured practical assessment with its submission counts.
// Reading is open to reviewers (scores:manage); authoring is programs:manage.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listPracticalAssessments } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'scores:manage');
    const supabase = createAdminClient();
    const result = await listPracticalAssessments(supabase);
    return successResponse({ success: true, ...result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load practical assessments');
  }
}
