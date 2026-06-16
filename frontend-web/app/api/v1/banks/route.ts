/**
 * GET /api/v1/banks
 *
 * List all Nigerian banks supported for outbound transfers (via Paystack).
 * Requires Bearer token and FEATURE_BANK_TRANSFERS_ENABLED.
 */
import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { listBanks } from '@/src/server/transfers/bank';

export async function GET(request: Request) {
  try {
    requireFeature('walletBankTransfers');
    await requireRequestUser(request);

    const banks = await listBanks();

    return NextResponse.json({ success: true, banks });
  } catch (err) {
    return handleApiError(err);
  }
}
