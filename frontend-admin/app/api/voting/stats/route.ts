import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

let _supabase: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contestantId = searchParams.get('contestantId');
    const competitionId = searchParams.get('competitionId');

    let query = supabase().from('contestant_vote_stats').select('*');

    if (contestantId) {
      query = query.eq('contestant_id', contestantId);
    }

    if (competitionId) {
      query = query.eq('competition_id', competitionId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('Error fetching vote stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vote stats' },
      { status: 500 }
    );
  }
}
