import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Proxy: /api/v1/me/tier → Go /api/v1/me/tier.
// Returns the caller's KYC tier alongside TODAY'S remaining wallet-debit allowance
// (dailyLimitKobo / dailyUsedKobo / remainingKobo / walletDisabled), read from the
// same finance/tiers.GetUsage that the fail-closed debit gate is derived from.
//
// This is deliberately a proxy rather than a Supabase read: the limit table and the
// "what counts as today's spend" rule are money rules, and a second implementation
// here would drift from the one the server actually enforces.
//
// Consumed by the mobile checkout sheet, which uses it to refuse a spend BEFORE
// opening the Paystack gateway — without it a Tier 0 customer completes a card
// charge and only then gets a 403 from the escrow. Advisory only: the server-side
// gate stays the authority.
export async function GET(request: Request) {
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/v1/me/tier');
  } catch (err) {
    return handleApiError(err);
  }
}
