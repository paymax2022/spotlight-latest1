import { NextRequest, NextResponse } from 'next/server';

// Shared contestant data for all platforms (web, mobile, admin)
const MOCK_CONTESTANTS = [
  {
    id: '1',
    name: 'Chioma Okonkwo',
    email: 'chioma@example.com',
    phone: '+234 805 678 9012',
    gender: 'Female',
    competition: 'Open Mic Q3',
    competitionId: '1',
    status: 'qualified',
    submissionDate: '2024-07-15',
    registrationDate: '2024-07-15',
    contestantNumber: 'OM-Q3-0041',
    bio: 'Award-winning poet and spoken word artist with international recognition.',
    score: 87,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 15,
    totalVotes: 15,
  },
  {
    id: '2',
    name: 'Tunde Adeyemi',
    email: 'tunde@example.com',
    phone: '+234 802 123 4567',
    gender: 'Male',
    competition: 'Open Mic Q3',
    competitionId: '1',
    status: 'pending',
    submissionDate: '2024-07-18',
    registrationDate: '2024-07-18',
    contestantNumber: 'OM-Q3-0042',
    bio: 'Passionate musician and songwriter with 5 years of performance experience.',
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 36,
    totalVotes: 36,
  },
  {
    id: '3',
    name: 'Amara Ejiro',
    email: 'amara@example.com',
    phone: '+234 701 234 5678',
    gender: 'Female',
    competition: 'Reality TV',
    competitionId: '2',
    status: 'qualified',
    submissionDate: '2024-06-20',
    registrationDate: '2024-06-20',
    contestantNumber: 'RTV-Q3-0089',
    bio: 'Dynamic TV personality with 7 years of entertainment industry experience.',
    score: 92,
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 25,
    totalVotes: 25,
  },
  {
    id: '4',
    name: 'Nonso Ifeanyi',
    email: 'nonso@example.com',
    phone: '+234 809 876 5432',
    gender: 'Male',
    competition: 'Open Mic Q3',
    competitionId: '1',
    status: 'disqualified',
    submissionDate: '2024-07-12',
    registrationDate: '2024-07-12',
    contestantNumber: 'OM-Q3-0040',
    bio: 'Emerging comedy talent with a unique perspective on social issues.',
    freeVotes: 0,
    paidVotes: 0,
    adminVotes: 0,
    totalVotes: 0,
  },
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const competitionId = searchParams.get('competitionId');
    const contestantId = searchParams.get('id');

    let filtered = MOCK_CONTESTANTS;

    // Filter by competition if provided
    if (competitionId) {
      filtered = filtered.filter(c => c.competitionId === competitionId);
    }

    // Filter by contestant ID if provided
    if (contestantId) {
      filtered = filtered.filter(c => c.id === contestantId);
    }

    return NextResponse.json({
      success: true,
      data: filtered,
      count: filtered.length,
    });
  } catch (error) {
    console.error('Error fetching contestants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contestants' },
      { status: 500 }
    );
  }
}
