// Admin: one topic's practical assessment. GET is read-only for reviewers;
// PUT is the authoring action and may open or withdraw the mastery gate.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  asActorId,
  getPracticalAssessmentForAdmin,
  upsertPracticalAssessment,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'scores:manage');
    const { topicId } = await ctx.params;
    const supabase = createAdminClient();
    const result = await getPracticalAssessmentForAdmin(supabase, topicId);
    return successResponse({ success: true, ...result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the practical assessment');
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'programs:manage');
    const { topicId } = await ctx.params;
    const body = await request.json().catch(() => null);
    const supabase = createAdminClient();
    const result = await upsertPracticalAssessment(
      supabase,
      asActorId(admin.actorId),
      topicId,
      body,
    );
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to save the practical assessment');
  }
}
