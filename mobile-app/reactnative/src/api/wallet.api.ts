import { api } from '@/api/client';
import { createSupabaseClient } from '@/lib/supabase';
import { mapWalletFromApi, mapWalletFromSupabase, resolveFallbackBalanceKobo } from '@/api/mappers/wallet.mapper';
import type { Wallet } from '@/types/wallet';
import { generateIdempotencyKey } from '@/utils/idempotency';

const ZERO_WALLET: Wallet = { balance: 0, currency: 'NGN', ledgerBalance: 0, pendingBalance: 0 };

// Spendable naira planes — mirrors SPENDABLE_WALLET_TYPES in
// frontend-web/src/server/wallet/account-type.ts (ADR-045): the unified
// 'user_wallet' pot plus the pre-consolidation 'wallet' pot the balance read
// still sums, so residue the sweep migration missed stays visible.
const SPENDABLE_WALLET_TYPES = ['user_wallet', 'wallet'];

type SpendableRow = Record<string, unknown>;

/**
 * Fetch the wallet balance.
 *
 * Primary path  → Next.js API /api/v1/wallet/balance (authoritative, KYC-gated).
 * Fallback path → Supabase, mirroring the server's getBalance(): the spendable
 * wallet_balance rows summed, then the legacy mobile_fintech_accounts plane.
 *
 * The fallback keeps the REAL balance visible when the Next.js server is
 * offline, the wallet feature flag is off, or the user's KYC tier is below
 * the API gate (the views/tables are already scoped by user_id RLS). When no
 * source can produce a figure it flags `balanceUnavailable` — a fabricated
 * ₦0.00 would mask money the user actually has, which is worse than showing
 * nothing.
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
    const fallback = await getWalletFromSupabase();
    return fallback ?? { ...ZERO_WALLET, balanceUnavailable: true };
  }
}

async function getWalletFromSupabase(): Promise<Wallet | null> {
  try {
    const supabase = createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // wallet_balance is one row PER ledger_accounts row — a user can hold
    // several (user_wallet, escrow, virtual_account, group_wallet, …). The
    // old unfiltered maybeSingle() errored on >1 row and produced ₦0.00,
    // masking real balances; even a single row could be a non-spendable
    // account. Filter to the spendable naira planes and SUM them, exactly
    // like the server's getBalance() (frontend-web/src/server/wallet/service.ts).
    const { data: rows, error } = await supabase
      .from('wallet_balance')
      .select('account_id, account_type, available_kobo')
      .eq('user_id', user.id)
      .eq('currency', 'NGN')
      .in('account_type', SPENDABLE_WALLET_TYPES);

    if (error) return null;
    const spendableRows = (rows ?? []) as SpendableRow[];

    // The legacy plane only matters when the ledger nets to zero — same rule
    // as the server — and only when the unified account has never had an
    // entry (otherwise the zero is real: the money arrived and was spent).
    let unifiedHasEntries = false;
    let legacyBalanceNaira: number | null = null;
    let legacyCurrency: string | null = null;

    const spendableTotal = spendableRows.reduce((s, r) => s + Number(r.available_kobo ?? 0), 0);
    if (spendableTotal === 0) {
      const unifiedId = spendableRows.find((r) => r.account_type === 'user_wallet')?.account_id;
      if (unifiedId != null) {
        const { count } = await supabase
          .from('ledger_entries')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', String(unifiedId));
        unifiedHasEntries = (count ?? 0) > 0;
      }
      if (!unifiedHasEntries) {
        // available_balance is NAIRA (major units) — resolveFallbackBalanceKobo
        // converts. RLS (mobile_fintech_accounts_user_select) scopes this to
        // the caller's own row.
        const { data: legacy } = await supabase
          .from('mobile_fintech_accounts')
          .select('available_balance, currency')
          .eq('user_id', user.id)
          .maybeSingle();
        legacyBalanceNaira = Number(legacy?.available_balance ?? 0);
        legacyCurrency = typeof legacy?.currency === 'string' ? legacy.currency : null;
      }
    }

    const kobo = resolveFallbackBalanceKobo({ spendableRows, unifiedHasEntries, legacyBalanceNaira });
    return mapWalletFromSupabase({ available_kobo: kobo, currency: legacyCurrency ?? 'NGN' });
  } catch {
    return null;
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

export async function initiateFunding(payload: {
  /**
   * Amount in KOBO (integer minor units) — it is sent straight through as
   * `amount_kobo`. Named explicitly because the previous name (`amount`) read as
   * naira and had already produced a 100x under-top-up in features/payments/api.ts.
   */
  amountKobo: number;
  callbackUrl?: string;
  /**
   * 'checkout' when this top-up funds a purchase the user is completing right now
   * (the card rail, ADR-041). It carries a different KYC gate server-side — an
   * unverified account may be allowed a capped checkout top-up while standalone
   * funding still requires Tier 1 (ADR-042). Defaults to standalone funding.
   */
  purpose?: 'wallet' | 'checkout';
  /**
   * What the checkout is buying — 'vote_purchase', 'food_order', ... Recorded
   * server-side so the funding is not filed as an anonymous wallet top-up.
   * Ignored for standalone funding, which is not buying anything.
   */
  domain?: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const res  = await api.post('/api/v1/wallet/topup',
    {
      amount_kobo: payload.amountKobo,
      checkout_domain: payload.domain,
      callback_url: payload.callbackUrl,
      purpose: payload.purpose ?? 'wallet',
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

export interface VirtualAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: string;
}

/**
 * Fetches the caller's dedicated bank-transfer account, provisioning it on the
 * server on first call if it doesn't exist yet — so this always returns real
 * account details for a Tier-1+ user rather than a "come back later" state.
 * Requires KYC Tier 1; the server 403s below that (see topup-gate.ts's
 * STANDALONE_TOPUP_TIER, the same gate card top-up uses for standalone funding).
 */
export async function getVirtualAccount(): Promise<VirtualAccount> {
  const res = await api.get('/api/v1/virtual-accounts/me');
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  const account = (data.account ?? {}) as Record<string, unknown>;
  return {
    accountNumber: String(account.account_number ?? ''),
    accountName:   String(account.account_name ?? ''),
    bankName:      String(account.bank_name ?? ''),
    currency:      String(account.currency ?? 'NGN'),
  };
}
