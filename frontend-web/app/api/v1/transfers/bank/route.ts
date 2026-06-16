/**
 * POST /api/v1/transfers/bank
 *
 * Transfer funds from the authenticated user's wallet to any Nigerian bank account.
 * Funds are reserved atomically before Paystack is called.
 * Final status is delivered via webhook (transfer.success / transfer.failed).
 *
 * Requires:
 *   - Bearer token
 *   - Idempotency-Key header
 *   - FEATURE_BANK_TRANSFERS_ENABLED
 *
 * Body: { bank_code, account_number, amount_kobo, narration?, save_beneficiary? }
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { resolveBankAccount, initiateWalletToBank, calculateBankTransferFee } from '@/src/server/transfers/bank';

export async function POST(request: Request) {
  try {
    requireFeature('walletBankTransfers');

    const user = await requireRequestUser(request);

    const idempotencyKey = (request.headers.get('Idempotency-Key') ?? '').trim();
    if (!idempotencyKey) throw new ApiError('Idempotency-Key header is required', 400);

    const body = (await request.json()) as {
      bank_code?: unknown;
      account_number?: unknown;
      amount_kobo?: unknown;
      narration?: unknown;
      save_beneficiary?: unknown;
    };

    const bankCode         = String(body.bank_code ?? '').trim();
    const accountNumber    = String(body.account_number ?? '').trim().replace(/\D/g, '');
    const amountKobo       = Number(body.amount_kobo);
    const narration        = typeof body.narration === 'string' ? body.narration.slice(0, 100) : undefined;
    const saveBeneficiary  = body.save_beneficiary === true;

    if (!bankCode)                           throw new ApiError('bank_code is required', 400);
    if (accountNumber.length !== 10)         throw new ApiError('account_number must be 10 digits', 400);
    if (!Number.isInteger(amountKobo) || amountKobo < 100_000) {
      throw new ApiError('amount_kobo must be an integer ≥ 100,000 (₦1,000 minimum)', 400);
    }

    // Resolve account name (validates the account exists at the bank)
    const resolved = await resolveBankAccount(bankCode, accountNumber);

    // We don't know the bank name without fetching the list; use a placeholder
    // that the client should supply, or fall back to bank_code.
    // TODO: accept bank_name in body once client sends it.
    const bankName = bankCode;

    const result = await initiateWalletToBank({
      userId:          user.id,
      bankCode,
      bankName,
      accountNumber,
      accountName:     resolved.accountName,
      amountKobo,
      idempotencyKey,
      narration,
      saveBeneficiary,
    });

    const feeKobo = calculateBankTransferFee(amountKobo);

    return NextResponse.json({
      success:           true,
      already_processed: result.alreadyProcessed,
      transfer: {
        id:                  result.transferId,
        reference:           result.reference,
        amount_kobo:         result.amountKobo,
        fee_kobo:            result.feeKobo,
        total_debit_kobo:    result.amountKobo + result.feeKobo,
        account_name:        result.accountName,
        account_number_last4: result.accountNumberLast4,
        bank_name:           result.bankName,
        narration:           narration ?? null,
        status:              result.status,
        created_at:          result.createdAt,
      },
      fee_schedule: { fee_kobo: feeKobo, amount_kobo: amountKobo },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
