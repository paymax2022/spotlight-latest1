// Admin: grade submitted practical work against its frozen rubric. The pass
// mark is fixed at submit; the reviewer supplies criterion points, not a score.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { asActorId, gradePracticalSubmission } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ submissionId: string }> },
) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'scores:manage');
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => null);
    const supabase = createAdminClient();
    const result = await gradePracticalSubmission(
      supabase,
      asActorId(admin.actorId),
      submissionId,
      body,
    );
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to grade the practical submission');
  }
}
