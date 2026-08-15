import { NextRequest, NextResponse } from 'next/server';

// Shared leaderboard data
const MOCK_LEADERBOARD = [
  {
    rank: 1,
    contestantId: '2',
    name: 'Tunde Adeyemi',
    competition: 'Open Mic Q3',
    totalVotes: 36,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 36,
    status: 'pending',
  },
  {
    rank: 2,
    contestantId: '3',
    name: 'Amara Ejiro',
    competition: 'Reality TV',
    totalVotes: 25,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 25,
    status: 'qualified',
  },
  {
    rank: 3,
    contestantId: '1',
    name: 'Chioma Okonkwo',
    competition: 'Open Mic Q3',
    totalVotes: 15,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 15,
    status: 'qualified',
  },
  {
    rank: 4,
    contestantId: '4',
    name: 'Nonso Ifeanyi',
    competition: 'Open Mic Q3',
    totalVotes: 0,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 0,
    status: 'disqualified',
  },
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const competitionId = searchParams.get('competitionId');
    const limit = parseInt(searchParams.get('limit') || '100');

    let filtered = MOCK_LEADERBOARD;

    if (competitionId) {
      filtered = filtered.filter(item =>
        item.competition === competitionId || item.competition.includes(competitionId)
      );
    }

    const limited = filtered.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: limited,
      count: limited.length,
      total: filtered.length,
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
