// Admin: one topic with its evaluated gates, media queue, holds and mastery.
// PATCH performs an explicit workflow action. Content authoring uses
// programs:manage; approving/publishing an assessment uses scores:manage, so a
// content editor cannot approve their own article.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  asActorId,
  getAdminTopic,
  mutateAdminTopic,
  type TopicAdminAction,
  type TopicAdminInput,
} from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

// Approving an article is an academic sign-off, not an authoring edit: the
// authoring role can prepare and submit it, but only scores:manage can approve,
// withdraw a waiver or publish. This keeps author and approver separate.
const SCORE_ACTIONS: TopicAdminAction[] = ['approve', 'publish', 'unpublish', 'set_accessible_equivalent'];

export async function GET(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'programs:manage');
    const { topicId } = await ctx.params;
    const supabase = createAdminClient();
    const topic = await getAdminTopic(supabase, topicId);
    return successResponse({ success: true, topic });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the topic');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const body = (await request.json().catch(() => null)) as TopicAdminInput | null;
    const action = String(body?.action ?? '') as TopicAdminAction;
    if (!action) return errorResponse('action is required', 400);

    const permission = SCORE_ACTIONS.includes(action) ? 'scores:manage' : 'programs:manage';
    const admin = await assertAdminPermission(request, permission);
    const { topicId } = await ctx.params;
    const supabase = createAdminClient();
    const result = await mutateAdminTopic(supabase, asActorId(admin.actorId), topicId, {
      ...(body ?? { action }),
      action,
    });
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to update the topic');
  }
}
