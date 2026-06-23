/**
 * POST /api/v1/transfers/paymax
 *
 * Instantly transfer funds from the authenticated user's wallet to another
 * Paymax user. Atomic: sender is debited and receiver is credited in a single
 * DB transaction via transfer_wallet_atomic RPC.
 *
 * Requires:
 *   - Bearer token
 *   - Idempotency-Key header
 *   - FEATURE_WALLET_TRANSFERS_ENABLED
 *
 * Body: { recipient_identifier, amount_kobo, narration? }
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { initiateWalletToWallet, calculateTransferFee } from '@/src/server/transfers/wallet-to-wallet';

export async function POST(request: Request) {
  try {
    requireFeature('walletTransfers');

    const user = await requireRequestUser(request);

    const idempotencyKey = (
      request.headers.get('Idempotency-Key') ?? ''
    ).trim();
    if (!idempotencyKey) {
      throw new ApiError('Idempotency-Key header is required', 400);
    }

    const body = (await request.json()) as {
      recipient_identifier?: unknown;
      amount_kobo?: unknown;
      narration?: unknown;
    };

    const recipientIdentifier = String(body.recipient_identifier ?? '').trim();
    if (!recipientIdentifier) {
      throw new ApiError('recipient_identifier is required', 400);
    }

    const amountKobo = Number(body.amount_kobo);
    if (!Number.isInteger(amountKobo) || amountKobo < 100) {
      throw new ApiError('amount_kobo must be an integer ≥ 100 (₦1 minimum)', 400);
    }

    const narration =
      typeof body.narration === 'string' ? body.narration.slice(0, 100) : undefined;

    const result = await initiateWalletToWallet({
      senderId: user.id,
      recipientIdentifier,
      amountKobo,
      idempotencyKey,
      narration,
    });

    return NextResponse.json({
      success: true,
      already_processed: result.alreadyProcessed,
      transfer: {
        id:                    result.transferId,
        reference:             result.reference,
        amount_kobo:           result.amountKobo,
        fee_kobo:              result.feeKobo,
        total_debit_kobo:      result.amountKobo + result.feeKobo,
        narration:             narration ?? null,
        status:                'successful',
        receiver_display_name: result.receiverDisplayName,
        created_at:            result.createdAt,
      },
      // Fee disclosure for the client to show "You'll be charged ₦X fee"
      fee_schedule: {
        fee_kobo: calculateTransferFee(amountKobo),
        amount_kobo: amountKobo,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
