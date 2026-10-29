/**
 * Utility payment gate — the checks a bill payment must pass BEFORE a
 * transaction row is written or a payment rail is touched.
 *
 *   wallet   Tier 0 may pay at most ₦20,000 per bill and ₦50,000 of wallet
 *            debits per UTC day; above the per-bill cap the member is asked
 *            for KYC Tier 1 instead of being debited. Tier 1+ keeps its own
 *            tier daily cap (tiers/service.ts) and no per-bill cap.
 *   paystack Any tier: at most ₦20,000 per bill and ₦50,000 per UTC day across
 *            the member's non-failed Paystack bill intents. Runs before the
 *            intent is written and before Paystack is initialised, so a refused
 *            payment never reaches the gateway.
 *
 * Fail closed: a tier or ledger read error refuses with 503.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { enforceWalletLimit, type Tier0Allowance } from '@/src/server/tiers/service';

export type UtilityPaymentRail = 'wallet' | 'paystack';

export const UTILITY_TIER0_TXN_MAX_KOBO = 2_000_000;
export const UTILITY_TIER0_DAILY_CAP_KOBO = 5_000_000;
export const UTILITY_GATEWAY_TXN_MAX_KOBO = 2_000_000;
export const UTILITY_GATEWAY_DAILY_CAP_KOBO = 5_000_000;

/** Pass to debitWallet so the wallet debit honours the same Tier 0 allowance the gate did. */
export const UTILITY_TIER0_ALLOWANCE: Tier0Allowance = Object.freeze({
  perTransactionMaxKobo: UTILITY_TIER0_TXN_MAX_KOBO,
  dailyLimitKobo: UTILITY_TIER0_DAILY_CAP_KOBO,
});

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function enforceUtilityPaymentGate(
  userId: string,
  rail: UtilityPaymentRail,
  retailAmountKobo: number,
): Promise<void> {
  if (!Number.isInteger(retailAmountKobo) || retailAmountKobo <= 0) {
    throw new ApiError('Amount must be a positive integer number of kobo.', 400);
  }
  if (rail === 'wallet') {
    await enforceWalletLimit(userId, retailAmountKobo, UTILITY_TIER0_ALLOWANCE);
    return;
  }
  await enforceGatewayLimit(userId, retailAmountKobo);
}

async function enforceGatewayLimit(userId: string, retailAmountKobo: number): Promise<void> {
  if (retailAmountKobo > UTILITY_GATEWAY_TXN_MAX_KOBO) {
    throw new ApiError(
      `Card and bank payments are limited to ${naira(UTILITY_GATEWAY_TXN_MAX_KOBO)} per bill. Pay from your wallet for larger amounts.`,
      403,
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('utility_paystack_intents')
    .select('retail_amount_kobo')
    .eq('user_id', userId)
    .in('status', ['pending', 'completed'])
    .gte('created_at', startOfUtcDayIso());

  if (error) {
    console.error('[utility] gateway daily-limit read failed:', error.message);
    throw new ApiError('Payment limit check failed. Please try again.', 503);
  }

  const usedToday = ((data ?? []) as Array<{ retail_amount_kobo: number | string }>).reduce(
    (sum, row) => sum + (Number(row.retail_amount_kobo) || 0),
    0,
  );
  if (usedToday + retailAmountKobo > UTILITY_GATEWAY_DAILY_CAP_KOBO) {
    throw new ApiError(
      `Daily card and bank payment limit of ${naira(UTILITY_GATEWAY_DAILY_CAP_KOBO)} reached. Pay from your wallet or try again tomorrow.`,
      403,
    );
  }
}
