import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { getActiveVotePackages } from '@/src/server/voting/paid-vote.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    // Non-UUID ids can never match vote_packages.contest_id — reject before the
    // query so a malformed id doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(contestId)) {
      return errorResponse('Invalid contest ID', 400);
    }
    const packages = await getActiveVotePackages(contestId);
    return NextResponse.json(packages);
  } catch (error) {
    return handleApiError(error, 'Failed to load vote packages');
  }
}
