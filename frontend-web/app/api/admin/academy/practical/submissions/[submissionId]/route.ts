// Admin: one practical submission with the frozen rubric and the learner's work.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { getPracticalSubmissionForAdmin } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ submissionId: string }> },
) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'scores:manage');
    const { submissionId } = await ctx.params;
    const supabase = createAdminClient();
    const submission = await getPracticalSubmissionForAdmin(supabase, submissionId);
    return successResponse({ success: true, submission });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the practical submission');
  }
}
