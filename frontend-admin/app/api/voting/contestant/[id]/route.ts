import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// GET contestant votes
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Fetch contestant votes from database
    const { data: adminVotes, error: votesError } = await supabase
      .from('admin_votes')
      .select('*')
      .eq('contestant_id', id)
      .single();

    if (votesError && votesError.code !== 'PGRST116') {
      throw votesError;
    }

    // Fetch audit log
    const { data: auditLog, error: auditError } = await supabase
      .from('vote_audit_log')
      .select('*')
      .eq('contestant_id', id)
      .order('created_at', { ascending: false });

    if (auditError) {
      throw auditError;
    }

    // Fetch vote stats
    const { data: voteStats, error: statsError } = await supabase
      .from('contestant_vote_stats')
      .select('*')
      .eq('contestant_id', id)
      .single();

    if (statsError && statsError.code !== 'PGRST116') {
      throw statsError;
    }

    return NextResponse.json({
      adminVotes: adminVotes?.vote_count || 0,
      auditLog: auditLog || [],
      voteStats: voteStats || {
        free_votes: 0,
        paid_votes: 0,
        admin_votes: adminVotes?.vote_count || 0,
        total_votes: adminVotes?.vote_count || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching votes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch votes' },
      { status: 500 }
    );
  }
}

// POST add votes
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const { voteCount, adminName, adminId, competitionId } = body;

    if (!voteCount || voteCount < 1) {
      return NextResponse.json(
        { error: 'Vote count must be at least 1' },
        { status: 400 }
      );
    }

    // Get current vote count
    const { data: existingVotes } = await supabase
      .from('admin_votes')
      .select('*')
      .eq('contestant_id', id)
      .single();

    const currentVotes = existingVotes?.vote_count || 0;

    // Upsert admin votes
    const { error: upsertError } = await supabase
      .from('admin_votes')
      .upsert(
        {
          contestant_id: id,
          vote_count: currentVotes + voteCount,
          admin_id: adminId || 'system',
          admin_name: adminName || 'Admin',
          competition_id: competitionId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'contestant_id,admin_id',
        }
      );

    if (upsertError) {
      throw upsertError;
    }

    // Log the vote action
    const { error: auditError } = await supabase
      .from('vote_audit_log')
      .insert({
        contestant_id: id,
        vote_amount: voteCount,
        admin_id: adminId || 'system',
        admin_name: adminName || 'Admin',
        action: 'vote_added',
      });

    if (auditError) {
      throw auditError;
    }

    // Update vote stats
    const { error: statsError } = await supabase
      .from('contestant_vote_stats')
      .upsert({
        contestant_id: id,
        admin_votes: currentVotes + voteCount,
        total_votes: currentVotes + voteCount, // This should be updated with free_votes + paid_votes as well
        updated_at: new Date().toISOString(),
      });

    if (statsError && statsError.code !== 'PGRST116') {
      console.error('Stats update error:', statsError);
      // Don't fail the request if stats update fails
    }

    return NextResponse.json({
      success: true,
      totalVotes: currentVotes + voteCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error adding votes:', error);
    return NextResponse.json(
      { error: 'Failed to add votes' },
      { status: 500 }
    );
  }
}
