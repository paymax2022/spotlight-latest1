import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { CONTEST_STATUSES, isContestStatus } from '@/src/server/registration-v2/contest-store';

/**
 * PATCH /api/admin/contests/:slug/status — publish or unpublish a contest.
 *
 * This is the control the rest of the pipeline assumed existed and did not.
 * Contests were written as 'draft' (now 'upcoming'), and NOTHING in the codebase
 * could move a contest's status afterwards: the admin voting routes all write
 * voting_settings, vote_packages or contestant_votes, never contests.status, and
 * there is no Go writer. A contest created in the admin was therefore stuck below
 * the visibility threshold of both planes with no way to raise it.
 *
 * Visibility, for reference:
 *   draft    → hidden on web (/api/v1/contests filters active|upcoming) and
 *              hidden on mobile (mirror → draft; Go filters open|closed)
 *   upcoming → visible on web, hidden on mobile
 *   active   → visible on web, LIVE on mobile (mirror maps active → open)
 *   ended    → visible on web, CLOSED on mobile
 *
 * The contests → connect_contests trigger fires on UPDATE, so the mobile plane
 * follows this write with no extra step.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const params = await ctx.params;
    // Same permission as the sibling contest routes. Publishing changes what the
    // public sees, so it is never looser than editing the definition.
    await assertAdminPermission(request, 'programs:manage');

    const body = await request.json().catch(() => ({}));
    const status = body?.status;
    if (!isContestStatus(status)) {
      return errorResponse(`status must be one of: ${CONTEST_STATUSES.join(', ')}.`, 400);
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('contests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('slug', params.slug)
      .select('id, slug, name, status')
      .maybeSingle();

    if (error) return errorResponse(`Failed to update contest status: ${error.message}`, 500);
    // A slug that matches nothing is a 404, not a silent success — the caller
    // would otherwise believe it published something.
    if (!data) return errorResponse('Contest not found.', 404);

    // Report what the mobile plane actually ended up with, rather than implying
    // it from the contests row: the mirror skips titles it cannot represent.
    const { data: mirrored } = await supabase
      .from('connect_contests')
      .select('status')
      .eq('id', data.id as string)
      .maybeSingle();

    return successResponse({
      success: true,
      contest: data,
      mobileStatus: mirrored?.status ?? null,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to update contest status');
  }
}
