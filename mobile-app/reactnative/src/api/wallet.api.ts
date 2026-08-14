import { api } from '@/api/client';
import { createSupabaseClient } from '@/lib/supabase';
import { mapWalletFromApi, mapWalletFromSupabase } from '@/api/mappers/wallet.mapper';
import { Wallet } from '@/types/wallet';
import { generateIdempotencyKey } from '@/utils/idempotency';

const ZERO_WALLET: Wallet = { balance: 0, currency: 'NGN', ledgerBalance: 0, pendingBalance: 0 };

/**
 * Fetch the wallet balance.
 *
 * Primary path  → Next.js API /api/v1/wallet/balance (authoritative, KYC-gated).
 * Fallback path → Supabase wallet_balance view queried directly.
 *
 * The fallback ensures the balance is always visible even when the Next.js
 * server is offline, the wallet feature flag is off, or the user's KYC tier
 * is below the API gate. The view is already scoped by user_id RLS.
 */
export async function getWallet(): Promise<Wallet> {
  try {
    const res = await api.get('/api/v1/wallet/balance');
    const data = (res.data?.data ?? res.data) as Record<string, unknown>;
    if (data.available_kobo != null) {
      return mapWalletFromSupabase(data);
    }
    return mapWalletFromApi(data);
  } catch {
    return getWalletFromSupabase();
  }
}

async function getWalletFromSupabase(): Promise<Wallet> {
  try {
    const supabase = createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return ZERO_WALLET;

    const { data } = await supabase
      .from('wallet_balance')
      .select('available_kobo, currency')
      .eq('user_id', user.id)
      .maybeSingle();

    return data ? mapWalletFromSupabase(data) : ZERO_WALLET;
  } catch {
    return ZERO_WALLET;
  }
}

export interface TransactionListParams {
  serviceType?: string;
  status?: string;
  page?: number;
  limit?: number;
}

// Delegates to the transactions API so there is a single source of truth.
export { getTransactions as getWalletTransactions } from '@/api/transactions.api';

// ─── Wallet funding (server-side Paystack operations) ─────────────────────────

export async function initiateFunding(payload: {
  /**
   * Amount in KOBO (integer minor units) — it is sent straight through as
   * `amount_kobo`. Named explicitly because the previous name (`amount`) read as
   * naira and had already produced a 100x under-top-up in features/payments/api.ts.
   */
  amountKobo: number;
  callbackUrl?: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const res  = await api.post('/api/v1/wallet/topup',
    {
      amount_kobo: payload.amountKobo,
      callback_url: payload.callbackUrl,
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    authorizationUrl: String(data.authorizationUrl ?? data.authorization_url ?? ''),
    reference:        String(data.reference ?? data.payment_reference ?? ''),
  };
}

// NOTE: manual funding verification was removed — there is no backend route for it.
// Wallet top-ups are confirmed asynchronously by the Paystack webhook
// (frontend-web/app/api/webhooks/paystack/route.ts), which credits the ledger.
