/**
 * POST /api/v2/votes/free - Cast a free vote using the bridge
 * Requires X-Idempotency-Key header for deduplication
 */

import { NextRequest, NextResponse } from 'next/server';
import { bridgedCastFreeVote } from '@/server/voting-bridge/bridge';
import { validateRequest } from '@/lib/auth/request';

export async function POST(request: NextRequest) {
  try {
    // Get idempotency key from headers
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'X-Idempotency-Key header is required' },
        { status: 400 }
      );
    }

    // Validate authentication
    const { user, error: authError } = await validateRequest(request);
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { contestantId, contestId, shareCode } = body;

    if (!contestantId || !contestId) {
      return NextResponse.json(
        { error: 'Missing required fields: contestantId, contestId' },
        { status: 400 }
      );
    }

    // Get request context
    const ipAddress = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const deviceFingerprint = request.headers.get('X-Device-Fingerprint') || undefined;

    // Cast the vote via bridge
    const result = await bridgedCastFreeVote(
      {
        contestantId,
        contestId,
        shareCode,
      },
      user?.id,
      idempotencyKey,
      {
        ipAddress,
        userAgent,
        deviceFingerprint,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to cast vote' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      voteId: result.voteId,
      totalVotes: result.totalVotes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] /api/v2/votes/free POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
