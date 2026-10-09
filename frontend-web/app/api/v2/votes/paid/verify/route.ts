/**
 * POST /api/v2/votes/paid/verify - Verify and credit a paid vote
 * Uses the bridge to prevent webhook + redirect double-credit race
 */

import { NextRequest, NextResponse } from 'next/server';
import { bridgedVerifyPaidVote } from '@/server/voting-bridge/bridge';
import { validateRequest } from '@/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { getRequestIp } from '@/src/lib/rate-limit/client-ip';

export async function POST(request: NextRequest) {
  try {
    // 30/min/IP — mirrors vote:free. The vote-callback page polls this route
    // while Paystack settles, so it needs headroom; the limit exists to stop
    // payment_reference enumeration, not to squeeze legitimate retries.
    const rl = checkRateLimit(`vote:paid:verify:${getRequestIp(request)}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const { user, error: authError } = await validateRequest(request);

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const { transactionId, paymentReference } = body;

    if (!paymentReference) {
      return NextResponse.json(
        { error: 'Missing required field: paymentReference' },
        { status: 400 }
      );
    }

    // Paystack's browser redirect appends only `reference`/`trxref`, so
    // callers that never saw the initiation response (vote-callback page)
    // cannot supply transactionId. Resolve it from the transaction's unique
    // which answers 404 — the not-found taxonomy stays in one place.
    let resolvedTransactionId: string = transactionId ?? '';
    if (!resolvedTransactionId) {
      const supabase = createAdminClient();
      const { data: tx } = await supabase
        .from('vote_transactions')
        .select('id')
        .eq('payment_reference', paymentReference)
        .maybeSingle();
      resolvedTransactionId = tx?.id ?? '';
    }

    const ipAddress = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // 'system' when the webhook calls without auth
    const userId = user?.id || 'system';

    // Verify and credit the vote via bridge
    const result = await bridgedVerifyPaidVote(
      {
        transactionId: resolvedTransactionId,
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
      // alreadyProcessed/votesCredited match the shape the legacy
      // /api/votes/paid/verify response carried, so the two client call
      // sites (frontend-web/app/vote-callback/page.tsx, mobile's
      // verifyPaidVote()) work unchanged after cutting over to this route.
      // receiptNumber is a known parity gap: issueReceipt()/getReceiptNumber()
      // are private to the protected paid-vote.service.ts and not
      // separately importable — always null here until receipt generation
      // is added to the bridge itself.
      alreadyProcessed: result.alreadyProcessed ?? false,
      votesCredited: result.votesCredited,
      // Mobile's verifyPaidVote() reads newTotalVotes (not totalVotes) —
      // same value under both names so either client reads it correctly.
      newTotalVotes: result.totalVotes,
      receiptNumber: null,
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
 *
 * READ-ONLY resolver. This GET previously verified + credited votes — an
 * unauthenticated, unthrottled state-changing GET that could (a) permanently
 * mark a still-pending transaction 'failed' if hit before Paystack settled
 * (the webhook's own verify then bails on the failed status — paid money, no
 * votes), and (b) amplify calls to api.paystack.co. No live caller needs the
 * side effect: Paystack redirects land on /vote-callback, which POSTs here.
 * The GET now only reads the stored transaction state and redirects; actual
 * verify+credit happens exclusively through POST (rate-limited) or the
 * HMAC-verified /api/webhooks/paystack receiver.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getRequestIp(request);
    const rl = checkRateLimit(`vote:paid:verify:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetInMs / 1000)) } }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const transactionId = searchParams.get('transactionId');
    const paymentReference = searchParams.get('paymentReference');

    if (!transactionId || !paymentReference) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, paymentReference' },
        { status: 400 }
      );
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';
    const supabase = createAdminClient();
    const { data: tx } = await supabase
      .from('vote_transactions')
      .select('id, vote_credit_status, payment_status')
      .eq('id', transactionId)
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    if (tx.vote_credit_status === 'credited') {
      return NextResponse.redirect(
        new URL(`/voting/success?transactionId=${transactionId}`, siteUrl)
      );
    }
    if (tx.payment_status === 'failed' || tx.payment_status === 'abandoned') {
      return NextResponse.redirect(new URL('/voting/error', siteUrl));
    }
    // Still pending → hand the browser to the callback page, which runs the
    // real (POST) verify. Never credit from a GET.
    return NextResponse.redirect(
      new URL(
        `/vote-callback?reference=${encodeURIComponent(paymentReference)}&transactionId=${encodeURIComponent(transactionId)}`,
        siteUrl,
      )
    );
  } catch (error) {
    console.error('[API] /api/v2/votes/paid/verify GET error:', error);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com';
    return NextResponse.redirect(
      new URL('/voting/error', siteUrl)
    );
  }
}
