import { Wallet } from '@/types/wallet';

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
