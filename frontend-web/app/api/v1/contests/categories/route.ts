import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('contests')
      .select('category')
      .in('status', ['active', 'open', 'published'])
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
