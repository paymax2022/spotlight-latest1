import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    if (!contestId) return errorResponse('contestId is required', 400);

    const supabase = createAdminClient();

    // Find enrollment
    const { data: enrollment } = await supabase
      .from('competition_enrollments')
      .select('id')
      .eq('contest_id', contestId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!enrollment) return errorResponse('Not enrolled', 403);
    const contestantId = (enrollment as any).id;

    // Daily vote counts for last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: votes } = await supabase
      .from('votes')
      .select('vote_type, vote_quantity, created_at')
      .eq('contest_id', contestId)
      .eq('contestant_id', contestantId)
      .eq('vote_status', 'confirmed')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: true });

    // Group by day
    const dailyMap: Record<string, { free: number; paid: number; total: number }> = {};
    for (const v of votes ?? []) {
      const day = (v as any).created_at.split('T')[0];
      if (!dailyMap[day]) dailyMap[day] = { free: 0, paid: 0, total: 0 };
      const qty = Number((v as any).vote_quantity);
      if ((v as any).vote_type === 'free') dailyMap[day].free += qty;
      else if ((v as any).vote_type === 'paid') dailyMap[day].paid += qty;
      dailyMap[day].total += qty;
    }

    const timeline = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    return successResponse({ success: true, contestId, contestantId, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote timeline');
  }
}
