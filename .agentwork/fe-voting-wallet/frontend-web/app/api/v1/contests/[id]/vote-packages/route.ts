import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { getActiveVotePackages } from '@/src/server/voting/paid-vote.service';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    const packages = await getActiveVotePackages(contestId);
    return NextResponse.json(
      packages.map((p) => ({
        id: p.id,
        votes: p.votes,
        bonusVotes: p.bonusVotes,
        priceKobo: p.amount,
        label: p.name,
        popular: p.isRecommended,
      })),
    );
  } catch (error) {
    return handleApiError(error, 'Failed to load vote packages');
  }
}
