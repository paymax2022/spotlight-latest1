/**
 * POST /api/v2/votes/paid/verify - Verify and credit a paid vote
 * Uses the bridge to prevent webhook + redirect double-credit race
 */

import { NextRequest, NextResponse } from 'next/server';
import { bridgedVerifyPaidVote } from '@/server/voting-bridge/bridge';
import { validateRequest } from '@/lib/auth/request';

export async function POST(request: NextRequest) {
  try {
    // Validate authentication (for browser redirect)
    const { user, error: authError } = await validateRequest(request);

    // Parse request body
    const body = await request.json();
    const { transactionId, paymentReference } = body;

    if (!transactionId || !paymentReference) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, paymentReference' },
        { status: 400 }
      );
    }

    // Get request context
    const ipAddress = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Get user ID from auth or from the transaction itself
    // (in case webhook calls this without auth)
    const userId = user?.id || 'system';

    // Verify and credit the vote via bridge
    const result = await bridgedVerifyPaidVote(
      {
        transactionId,
        paymentReference,
      },
      userId,
      {
        ipAddress,
        userAgent,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to verify vote' },
        { status: result.statusCode ?? 400 }
      );
    }

    return NextResponse.json({
      success: true,
      voteId: result.voteId,
      totalVotes: result.totalVotes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] /api/v2/votes/paid/verify POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v2/votes/paid/verify?transactionId=...&paymentReference=...
 * Query-string variant for webhook calls (Paystack, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const transactionId = searchParams.get('transactionId');
    const paymentReference = searchParams.get('paymentReference');

    if (!transactionId || !paymentReference) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, paymentReference' },
        { status: 400 }
      );
    }

    // Get request context
    const ipAddress = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Verify and credit the vote via bridge
    const result = await bridgedVerifyPaidVote(
      {
        transactionId,
        paymentReference,
      },
      'webhook',
      {
        ipAddress,
        userAgent,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to verify vote' },
        { status: result.statusCode ?? 400 }
      );
    }

    // Redirect to success page (for webhook or browser callback)
    return NextResponse.redirect(
      new URL(`/voting/success?transactionId=${transactionId}`, request.url)
    );
  } catch (error) {
    console.error('[API] /api/v2/votes/paid/verify GET error:', error);
    return NextResponse.redirect(
      new URL('/voting/error', request.url)
    );
  }
}
