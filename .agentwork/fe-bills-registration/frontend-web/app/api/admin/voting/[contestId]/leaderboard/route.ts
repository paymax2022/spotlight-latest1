import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getLeaderboard, recomputeRanks } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const roundId = searchParams.get('roundId') ?? undefined;
    const limit = Math.min(1000, Number(searchParams.get('limit') ?? 200));

    const leaderboard = await getLeaderboard(contestId, roundId, limit);

    // Enrich with contestant names
    const supabase = createAdminClient();
    const ids = leaderboard.map((e) => e.contestantId);
    if (ids.length > 0) {
      const { data: contestants } = await supabase
        .from('competition_enrollments')
        .select('id, stage_name, user_profiles(full_name, avatar_url, state)')
        .in('id', ids);
      const byId = new Map((contestants ?? []).map((c: any) => [c.id, c]));
      for (const e of leaderboard) {
        const c = byId.get(e.contestantId) as any;
        if (c) {
          e.contestantName = c.user_profiles?.full_name ?? c.stage_name ?? 'Contestant';
          e.stageName = c.stage_name ?? null;
          e.photoUrl = c.user_profiles?.avatar_url ?? null;
          e.state = c.user_profiles?.state ?? null;
        }
      }
    }

    return successResponse({ success: true, contestId, leaderboard });
  } catch (error) {
    return handleApiError(error, 'Failed to load leaderboard');
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;
    await recomputeRanks(contestId);
    return successResponse({ success: true, message: 'Ranks recomputed' });
  } catch (error) {
    return handleApiError(error, 'Failed to recompute ranks');
  }
}
