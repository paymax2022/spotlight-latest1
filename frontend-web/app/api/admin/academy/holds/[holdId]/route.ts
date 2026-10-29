// Admin: clear a hold. If it was the last open hold and the quiz was already
// passed, the mastery ledger moves to MASTERED and the next topic unlocks.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { asActorId, clearAdminHold } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function PATCH(request: Request, ctx: { params: Promise<{ holdId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'scores:manage');
    const { holdId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { note?: string } | null;
    const supabase = createAdminClient();
    const result = await clearAdminHold(
      supabase,
      asActorId(admin.actorId),
      holdId,
      String(body?.note ?? ''),
    );
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to clear the hold');
  }
}
