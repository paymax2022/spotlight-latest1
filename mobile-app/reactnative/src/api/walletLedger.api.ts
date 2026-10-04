import { createSupabaseClient } from '@/lib/supabase';
import {
  INTERNAL_SWEEP_REFERENCE_LIKE,
  isCreditLedgerType,
  isInternalSweepReference,
  selectSpendableAccountIds,
  summarizeLedgerRows,
} from '@/api/mappers/walletLedger.mapper';

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
 *
 * Post-ADR-045 a user's history can span TWO spendable planes — 'user_wallet'
 * (canonical) and the swept-empty legacy 'wallet' account — so every read
 * resolves ALL of the user's wallet accounts, not one (AUD-FE-008).
 */

export type LedgerEntryType = 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';

// Balance formula (see wallet_balance view):
//   CREDIT, REVERSAL_DEBIT  → money IN  (+)
//   DEBIT,  REVERSAL_CREDIT → money OUT (−)
const isCredit = (type: LedgerEntryType) => isCreditLedgerType(type);

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

// Spendable naira planes — mirrors SPENDABLE_WALLET_TYPES in
// frontend-web/src/server/wallet/account-type.ts (ADR-045): the unified
// 'user_wallet' pot plus the legacy 'wallet' pot whose PRE-SWEEP history still
// belongs to the user even though the balance was moved to 'user_wallet'.
const WALLET_ACCOUNT_TYPES = ['user_wallet', 'wallet'];

/**
 * ALL of the current user's spendable wallet ledger account ids.
 *
 * wallet_balance is one row PER ledger_accounts row, and history follows the
 * USER, not whichever account happens to sort first: post-consolidation a user
 * can hold both 'user_wallet' (new activity) and 'wallet' (pre-sweep history).
 * The old order-ascending-limit-1 picked exactly one account, so every entry
 * on the other plane vanished from the transactions list and the
 * Income/Expenses totals (AUD-FE-008).
 *
 * Resolved from the `wallet_balance` view — the SAME source the displayed
 * balance sums — so the entries we read always belong to the accounts behind
 * that balance. Currency is pinned to NGN to match the balance read.
 */
async function getWalletAccountIds(): Promise<string[]> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('wallet_balance')
    .select('account_id')
    .eq('user_id', user.id)
    .eq('currency', 'NGN')
    .in('account_type', WALLET_ACCOUNT_TYPES);

  if (error || !data || data.length === 0) return [];
  return selectSpendableAccountIds(data as Record<string, unknown>[]);
}

/**
 * Recent wallet ledger entries (newest first), merged across ALL of the user's
 * spendable planes. Used for the transactions list.
 *
 * Internal plane-consolidation sweep legs (reference 'wallet-plane-consolidate:*',
 * ADR-045) are excluded at query level: they net to zero for the user and
 * would render as a phantom debit+credit pair. They stay in ledger_entries for
 * audit — this is a presentation filter only.
 *
 * Returns [] on any failure so the wallet screen degrades gracefully.
 */
export async function getWalletLedger(opts: { limit?: number } = {}): Promise<WalletLedgerEntry[]> {
  try {
    const accountIds = await getWalletAccountIds();
    if (accountIds.length === 0) return [];
    const limit = Math.min(opts.limit ?? 50, 200);

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, type, amount_kobo, reference, description, metadata, created_at')
      .in('account_id', accountIds)
      .not('reference', 'like', INTERNAL_SWEEP_REFERENCE_LIKE)
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
    const accountIds = await getWalletAccountIds();
    if (accountIds.length === 0) return empty;

    const supabase = createSupabaseClient();
    const WINDOW = 1000;
    let incomeKobo = 0;
    let expensesKobo = 0;
    let entryCount = 0;
    let offset = 0;

    // Advance the offset by the rows actually returned (PostgREST may cap a page
    // below WINDOW) and stop only on an empty page, so every entry is counted.
    // The iteration cap is a safety backstop against an unexpected non-empty loop.
    // Sweep legs are excluded at query level (same NOT LIKE as the list) so the
    // totals reflect real money movement; summarizeLedgerRows skips them again
    // defensively, so a row that slips the filter still cannot inflate totals.
    for (let i = 0; i < 500; i++) {
      const { data, error } = await supabase
        .from('ledger_entries')
        .select('type, amount_kobo, reference')
        .in('account_id', accountIds)
        .not('reference', 'like', INTERNAL_SWEEP_REFERENCE_LIKE)
        .order('created_at', { ascending: false })
        .range(offset, offset + WINDOW - 1);

      if (error) break;
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) break;
      const page = summarizeLedgerRows(rows);
      incomeKobo += page.incomeKobo;
      expensesKobo += page.expensesKobo;
      entryCount += page.entryCount;
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
    const entry = mapEntry(data as Row);
    // Internal sweep legs are not user-facing transactions (see getWalletLedger).
    if (isInternalSweepReference(entry.reference)) return null;
    return entry;
  } catch {
    return null;
  }
}
