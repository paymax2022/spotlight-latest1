// Admin: advance one teaching asset through production, rights and
// accessibility. Publishing an asset requires all three plus a real file URL;
// if this regresses a published topic, the topic is auto-unpublished.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { asActorId, updateAdminMedia, type MediaUpdateInput } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function PATCH(request: Request, ctx: { params: Promise<{ assetId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'programs:manage');
    const { assetId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as MediaUpdateInput | null;
    if (!body) return errorResponse('A JSON body is required', 400);

    const supabase = createAdminClient();
    const result = await updateAdminMedia(supabase, asActorId(admin.actorId), assetId, body);
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to update the teaching asset');
  }
}
