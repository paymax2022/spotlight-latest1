import type { Wallet } from '@/types/wallet';

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

export function mapWalletFromApi(raw: unknown): Wallet {
  const r = asRecord(raw);
  return {
    balance:        Number(r.balance ?? 0),
    currency:       String(r.currency ?? 'NGN'),
    ledgerBalance:  r.ledgerBalance != null ? Number(r.ledgerBalance) : r.ledger_balance != null ? Number(r.ledger_balance) : undefined,
    pendingBalance: r.pendingBalance != null ? Number(r.pendingBalance) : r.pending_balance != null ? Number(r.pending_balance) : undefined,
  };
}

// Maps the wallet_balance VIEW row (available_kobo → naira for the mobile UI).
// All bill-screen amounts are entered in naira, so we divide by 100 here so
// the entire UI stays consistent. The server always receives kobo.
export function mapWalletFromSupabase(raw: unknown): Wallet {
  const r = asRecord(raw);
  const balanceKobo = Number(r.available_kobo ?? 0);
  const balanceNaira = balanceKobo / 100;
  return {
    balance:        balanceNaira,
    currency:       String(r.currency ?? 'NGN'),
    ledgerBalance:  balanceNaira,
    pendingBalance: 0,
  };
}

/**
 * Derives the spendable balance (kobo) for the direct-Supabase fallback the
 * same way the server's getBalance() does
 * (frontend-web/src/server/wallet/service.ts, ADR-045):
 *
 *   1. Sum `available_kobo` over the spendable planes the caller already
 *      filtered to ('user_wallet' + 'wallet', NGN). Nonzero — that IS the
 *      balance (a negative net is still real, so `!== 0`, not `> 0`).
 *   2. Net zero AND the unified account carries ledger entries → genuinely
 *      ₦0 — the money arrived and was spent.
 *   3. Net zero AND no entries at all → the balance can still sit on the
 *      legacy `mobile_fintech_accounts` plane (`available_balance`, in
 *      NAIRA → ×100). The server migrates it inside getBalance(), which a
 *      KYC-gated user never reaches — the API 403s first — so reading it
 *      here is the only way that money stays visible instead of being
 *      masked behind a fabricated ₦0.00.
 */
export function resolveFallbackBalanceKobo(input: {
  spendableRows: ReadonlyArray<{ available_kobo?: unknown } & Record<string, unknown>>;
  unifiedHasEntries: boolean;
  legacyBalanceNaira?: number | null;
}): number {
  const total = input.spendableRows.reduce((sum, r) => sum + Number(r.available_kobo ?? 0), 0);
  if (total !== 0) return total;
  if (input.unifiedHasEntries) return 0;
  const legacy = Number(input.legacyBalanceNaira ?? 0);
  return legacy > 0 ? Math.round(legacy * 100) : 0;
}
