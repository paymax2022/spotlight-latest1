/**
 * POST /api/v2/votes/paid/initiate - Initiate a paid vote
 * Creates a transaction record and returns payment details
 * Does not use the bridge — direct call to protected initiatePaidVote()
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateRequest } from '@/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/admin';
import { randomUUID as uuidv4 } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // Validate authentication
    const { user, error: authError } = await validateRequest(request);
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { contestantId, contestId, amount } = body;

    if (!contestantId || !contestId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: contestantId, contestId, amount' },
        { status: 400 }
      );
    }

    // Create admin client
    const supabase = createAdminClient();

    // Generate a payment reference
    const paymentReference = `vote-${uuidv4()}`;
    const transactionId = uuidv4();

    // Step 1: Create vote transaction record
    const { data: transaction, error: txError } = await supabase
      .from('vote_transactions')
      .insert({
        id: transactionId,
        voter_id: user.id,
        contestant_id: contestantId,
        competition_id: contestId,
        amount_kobo: Math.round(amount * 100), // Convert to kobo (minor units)
        payment_reference: paymentReference,
        vote_credit_status: 'pending',
      })
      .select('*')
      .single();

    if (txError || !transaction) {
      console.error('[API] Failed to create transaction:', txError);
      return NextResponse.json(
        { error: 'Failed to create transaction' },
        { status: 500 }
      );
    }

    // Step 2: Return transaction details for payment initiation
    return NextResponse.json({
      success: true,
      transactionId,
      paymentReference,
      amount,
      amountKobo: Math.round(amount * 100),
      timestamp: new Date().toISOString(),
      // Include payment provider details (Paystack, etc.)
      // This would typically be returned by a payment service integration
      paymentUrl: `/api/v2/votes/paid/pay?transactionId=${transactionId}`,
    });
  } catch (error) {
    console.error('[API] /api/v2/votes/paid/initiate POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
