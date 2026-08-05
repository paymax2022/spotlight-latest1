import { createSupabaseClient } from '@/lib/supabase';

/**
 * Wallet ledger reads (the AUTHORITATIVE wallet money movements).
 *
 * The wallet balance is a projection of `ledger_entries` (see the wallet_balance
 * view). Income/Expenses on the wallet screen must be derived from the SAME
 * ledger — not from utility bill payments alone, which miss transfers, top-ups,
 * withdrawals, FX, etc. and are only a partial slice of spend.
 *
 * These are READ-only, RLS-scoped queries (`ledger_entries_select_own` /
 * `ledger_accounts_select_own`): a user can only ever see their own entries.
 * All amounts are integer kobo (minor units) — the UI divides by 100 for display.
 */

export type LedgerEntryType = 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';

// Balance formula (see wallet_balance view):
//   CREDIT, REVERSAL_DEBIT  → money IN  (+)
//   DEBIT,  REVERSAL_CREDIT → money OUT (−)
const CREDIT_TYPES: LedgerEntryType[] = ['CREDIT', 'REVERSAL_DEBIT'];

export interface WalletLedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** 'credit' = money in, 'debit' = money out (net direction on the balance). */
  direction: 'credit' | 'debit';
  amountKobo: number;
  reference: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface WalletFlowSummary {
  incomeKobo: number;
  expensesKobo: number;
  /** Number of ledger entries the totals were computed from. */
  entryCount: number;
}

type Row = { id?: unknown; type?: unknown; amount_kobo?: unknown; reference?: unknown; description?: unknown; metadata?: unknown; created_at?: unknown };

const isCredit = (type: LedgerEntryType) => CREDIT_TYPES.includes(type);

function mapEntry(r: Row): WalletLedgerEntry {
  const type = String(r.type ?? 'DEBIT') as LedgerEntryType;
  return {
    id:          String(r.id ?? ''),
    type,
    direction:   isCredit(type) ? 'credit' : 'debit',
    amountKobo:  Number(r.amount_kobo ?? 0),
    reference:   String(r.reference ?? ''),
    description: r.description != null ? String(r.description) : null,
    metadata:    (r.metadata && typeof r.metadata === 'object' ? r.metadata : null) as Record<string, unknown> | null,
    createdAt:   String(r.created_at ?? ''),
  };
}

// The spendable-wallet account type. Seeds/backend use 'user_wallet'; the
// frontend-web money service uses 'wallet'. Accept both so the lookup is correct
// across environments.
const WALLET_ACCOUNT_TYPES = ['user_wallet', 'wallet'];

/**
 * The current user's wallet ledger account id, or null if none exists yet.
 * Resolved from the `wallet_balance` view — the SAME source the displayed
 * balance comes from — so the entries we sum always belong to that account.
 */
async function getWalletAccountId(): Promise<string | null> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('wallet_balance')
    .select('account_id, account_type')
    .eq('user_id', user.id)
    .in('account_type', WALLET_ACCOUNT_TYPES)
    .order('account_type', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return String((data[0] as { account_id: string }).account_id);
}

/**
 * Recent wallet ledger entries (newest first). Used for the transactions list.
 * Returns [] on any failure so the wallet screen degrades gracefully.
 */
export async function getWalletLedger(opts: { limit?: number } = {}): Promise<WalletLedgerEntry[]> {
  try {
    const accountId = await getWalletAccountId();
    if (!accountId) return [];
    const limit = Math.min(opts.limit ?? 50, 200);

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, type, amount_kobo, reference, description, metadata, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .range(0, limit - 1);

    if (error || !data) return [];
    return (data as Row[]).map(mapEntry);
  } catch {
    return [];
  }
}

/**
 * Income / Expenses over the WHOLE wallet ledger (every entry, not a page).
 * Pages through all entries so the totals are complete and real; returns zeros
 * on failure or when the user has no ledger account yet.
 */
export async function getWalletFlowSummary(): Promise<WalletFlowSummary> {
  const empty: WalletFlowSummary = { incomeKobo: 0, expensesKobo: 0, entryCount: 0 };
  try {
    const accountId = await getWalletAccountId();
    if (!accountId) return empty;

    const supabase = createSupabaseClient();
    const WINDOW = 1000;
    let incomeKobo = 0;
    let expensesKobo = 0;
    let entryCount = 0;
    let offset = 0;

    // Advance the offset by the rows actually returned (PostgREST may cap a page
    // below WINDOW) and stop only on an empty page, so every entry is counted.
    // The iteration cap is a safety backstop against an unexpected non-empty loop.
    for (let i = 0; i < 500; i++) {
      const { data, error } = await supabase
        .from('ledger_entries')
        .select('type, amount_kobo')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + WINDOW - 1);

      if (error) break;
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        const type = String(r.type ?? 'DEBIT') as LedgerEntryType;
        const amt = Number(r.amount_kobo ?? 0);
        if (isCredit(type)) incomeKobo += amt;
        else expensesKobo += amt;
      }
      entryCount += rows.length;
      offset += rows.length;
    }

    return { incomeKobo, expensesKobo, entryCount };
  } catch {
    return empty;
  }
}

/** A single wallet ledger entry by id (RLS-scoped to the owner). */
export async function getWalletLedgerEntry(id: string): Promise<WalletLedgerEntry | null> {
  try {
    const supabase = createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, type, amount_kobo, reference, description, metadata, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return mapEntry(data as Row);
  } catch {
    return null;
  }
}
