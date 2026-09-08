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
        // vote_packages.amount is NAIRA, not kobo. paid-vote.service.ts is the
        // authority: it charges Math.round(amountExpected * 100) because
        // "Paystack uses kobo". Passing `amount` straight through under a field
        // NAMED priceKobo published every package at 1/100th of its price — a
        // ₦1,000 pack advertised as ₦10, then charged at ₦1,000.
        //
        // This never surfaced because the mobile app was reading mock packages;
        // the mock was masking a live-endpoint defect.
        priceKobo: Math.round(Number(p.amount ?? 0) * 100),
        label: p.name,
        popular: p.isRecommended,
      })),
    );
  } catch (error) {
    return handleApiError(error, 'Failed to load vote packages');
  }
}
