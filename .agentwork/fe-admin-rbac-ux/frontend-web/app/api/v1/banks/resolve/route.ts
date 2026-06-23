/**
 * POST /api/v1/banks/resolve
 *
 * Resolve a bank account number to get the account holder name.
 * Requires Bearer token and FEATURE_BANK_TRANSFERS_ENABLED.
 *
 * Body: { bank_code, account_number }
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { resolveBankAccount } from '@/src/server/transfers/bank';

export async function POST(request: Request) {
  try {
    requireFeature('walletBankTransfers');
    await requireRequestUser(request);

    const body = (await request.json()) as {
      bank_code?: unknown;
      account_number?: unknown;
    };

    const bankCode      = String(body.bank_code ?? '').trim();
    const accountNumber = String(body.account_number ?? '').trim().replace(/\D/g, '');

    if (!bankCode) throw new ApiError('bank_code is required', 400);
    if (accountNumber.length !== 10) throw new ApiError('account_number must be 10 digits', 400);

    const resolved = await resolveBankAccount(bankCode, accountNumber);

    return NextResponse.json({
      success:        true,
      account_name:   resolved.accountName,
      account_number: resolved.accountNumber,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
