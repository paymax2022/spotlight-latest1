import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { mapPrizeRow } from '../_shared';

type RouteContext = { params: Promise<{ prizeId: string }> };

// PATCH /api/admin/voting/contest-prizes/[prizeId]
// Allows updating prizeDescription/prizeValueKobo only. position and
// connectContestId are immutable — to move a prize to a different position,
// delete and recreate (simpler, avoids unique-constraint juggling).
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { prizeId } = await ctx.params;
    const body = await request.json();

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_prizes')
      .select('id')
      .eq('id', prizeId)
      .maybeSingle();

    if (fetchError) return errorResponse(`Failed to load prize: ${fetchError.message}`, 500);
    if (!existing) return errorResponse('Prize not found', 404);

    const updates: Record<string, unknown> = {};

    if (body.prizeDescription !== undefined) {
      if (typeof body.prizeDescription !== 'string' || !body.prizeDescription.trim()) {
        return errorResponse('prizeDescription must be a non-empty string', 400);
      }
      updates.prize_description = body.prizeDescription.trim();
    }

    if (body.prizeValueKobo !== undefined) {
      if (body.prizeValueKobo !== null && (!Number.isInteger(body.prizeValueKobo) || body.prizeValueKobo < 0)) {
        return errorResponse('prizeValueKobo must be a non-negative integer (kobo) or null', 400);
      }
      updates.prize_value_kobo = body.prizeValueKobo;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse('No updatable fields provided', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('contest_prizes')
      .update(updates)
      .eq('id', prizeId)
      .select('*')
      .single();

    if (updateError) return errorResponse(`Failed to update prize: ${updateError.message}`, 500);

    return successResponse({ success: true, prize: mapPrizeRow(updated) });
  } catch (error) {
    return handleApiError(error, 'Failed to update contest prize');
  }
}

// DELETE /api/admin/voting/contest-prizes/[prizeId]
export async function DELETE(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { prizeId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_prizes')
      .select('id')
      .eq('id', prizeId)
      .maybeSingle();

    if (fetchError) return errorResponse(`Failed to load prize: ${fetchError.message}`, 500);
    if (!existing) return errorResponse('Prize not found', 404);

    const { error: deleteError } = await supabase.from('contest_prizes').delete().eq('id', prizeId);
    if (deleteError) return errorResponse(`Failed to delete prize: ${deleteError.message}`, 500);

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete contest prize');
  }
}
