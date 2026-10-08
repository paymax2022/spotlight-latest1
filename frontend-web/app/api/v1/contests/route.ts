import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') ?? undefined;
    const search = searchParams.get('search') ?? undefined;

    const supabase = createAdminClient();

    let query = supabase
      .from('contests')
      .select('id, name, category, status, start_date, end_date')
      .in('status', ['active', 'upcoming'])
      .order('created_at', { ascending: false });

    if (category && category !== 'all') {
      query = query.ilike('category', `%${category}%`);
    }
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data: contests, error } = await query;
    if (error) throw error;

    if (!contests?.length) return NextResponse.json([]);

    const ids = contests.map((c: any) => c.id);

    const [{ data: settingsRows }, { data: totalsRows }, { data: contestantRows }] = await Promise.all([
      supabase
        .from('voting_settings')
        .select('contest_id, voting_enabled, voting_ends_at')
        .in('contest_id', ids),
      supabase
        .from('vote_totals')
        .select('contest_id, total_confirmed_votes')
        .in('contest_id', ids),
      // Roster count comes from the contestants table (contest_id FK to contests),
      // not vote_totals — a contestant with zero votes has no vote_totals row, so
      // counting those returned 0 for contests that have rosters. Status filter
      // mirrors /api/v1/contests/[id]/contestants so the number matches the roster.
      supabase
        .from('contestants')
        .select('contest_id')
        .in('contest_id', ids)
        .in('status', ['approved', 'active']),
    ]);

    const settingsById = new Map((settingsRows ?? []).map((s: any) => [s.contest_id, s]));
    const now = Date.now();

    // Aggregate vote totals and roster size per contest
    const totalsByContest: Record<string, number> = {};
    for (const t of totalsRows ?? []) {
      totalsByContest[t.contest_id] = (totalsByContest[t.contest_id] ?? 0) + (t.total_confirmed_votes ?? 0);
    }
    const countByContest: Record<string, number> = {};
    for (const r of contestantRows ?? []) {
      countByContest[r.contest_id] = (countByContest[r.contest_id] ?? 0) + 1;
    }

    const result = contests.map((c: any) => {
      const s = settingsById.get(c.id) as any;
      const totalVotes = totalsByContest[c.id] ?? 0;
      const endsAt = s?.voting_ends_at ?? c.end_date;
      const isLive = !!(s?.voting_enabled && endsAt && Date.parse(endsAt) > now);
      return {
        id: c.id,
        title: c.name,
        category: c.category || 'General',
        contestantCount: countByContest[c.id] ?? 0,
        totalVotes,
        endsAt: endsAt ?? new Date(Date.now() + 86_400_000).toISOString(),
        isLive,
        isTrending: totalVotes > 10_000,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list contests');
  }
}
