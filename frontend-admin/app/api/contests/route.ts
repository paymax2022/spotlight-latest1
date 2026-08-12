import { NextRequest, NextResponse } from 'next/server';

// Shared contests data for all platforms
const MOCK_CONTESTS = [
  {
    id: '1',
    name: 'Open Mic Q3',
    description: 'Quarter 3 Open Mic competition',
    status: 'active',
    startDate: '2024-07-01',
    endDate: '2024-09-30',
    participantCount: 3,
    totalVotes: 87,
  },
  {
    id: '2',
    name: 'Reality TV',
    description: 'Reality TV talent show',
    status: 'active',
    startDate: '2024-06-15',
    endDate: '2024-10-15',
    participantCount: 1,
    totalVotes: 25,
  },
];

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      success: true,
      data: MOCK_CONTESTS,
      count: MOCK_CONTESTS.length,
    });
  } catch (error) {
    console.error('Error fetching contests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contests' },
      { status: 500 }
    );
  }
}
