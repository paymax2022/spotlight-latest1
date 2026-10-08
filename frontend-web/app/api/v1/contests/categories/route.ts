import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('contests')
      .select('category')
      // contests.status is the contest_status enum ('draft'|'active'|'upcoming'|'ended'
      // — supabase/migrations/20260404210000_create_contests.sql). 'open' belongs to
      // connect_contests.status and 'published' to no enum at all; sending either
      // here 500s on enum coercion.
      // Matches the contest list route so counts reflect what the list shows.
      .in('status', ['active', 'upcoming'])
      .not('category', 'is', null);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const cat: string = (row.category as string) || 'General';
      counts[cat] = (counts[cat] ?? 0) + 1;
    }

    const categories = [
      { id: 'all', name: 'All', activeContestCount: (data ?? []).length },
      ...Object.entries(counts).map(([name, count]) => ({
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        activeContestCount: count,
      })),
    ];

    return NextResponse.json(categories);
  } catch (error) {
    return handleApiError(error, 'Failed to list categories');
  }
}
