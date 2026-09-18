// ── Admin — Centralized Transactions console ─────────────────────────────────
//
// LIVE ONLY. Talks to the Go backend at GET /api/finance/admin/transactions
// (RBAC: finance.admin.transactions.view — see backend/internal/app/finance_routes.go
// and backend/internal/finance/ledger/admin_handler.go).
//
// READ-ONLY reporting surface over ledger_entries — the ONLY source of truth
// for money movement across every module (there is no per-module transactions
// table). This service never posts, mutates, or reverses anything.
//
// `source_inferred` on each row is a BEST-EFFORT guess at which module
// produced the entry, derived server-side from SPLIT_PART(reference, ':', 1).
// It is NOT an authoritative field — reference-naming conventions are
// inconsistent across modules (colon-namespaced, dash-prefixed, or opaque
// UUIDs with no separator at all). Always render it as "Source (inferred)".
//
// Money model (iron rule: integers, never floats): amount_kobo is NGN kobo.
// formatKobo() is the only money-facing formatter.

import { apiRoot } from '@/config/env';

export type LedgerEntryType = 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';

export interface AdminTransactionRow {
  id: string;
  type: LedgerEntryType;
  amount_kobo: number;
  reference: string;
  source_inferred: string;
  description: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  account_id: string;
  account_type: string;
  currency: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_phone: string | null;
}

export interface AdminTransactionDetail extends AdminTransactionRow {
  // Every OTHER ledger_entries row sharing this transaction's reference — the
  // other leg(s) of the same balanced double-entry movement (a debit always
  // has a matching credit somewhere, often on a different account/user).
  //
  // CAVEAT: reference is not guaranteed unique per transaction across this
  // codebase (some code paths reuse one literal constant reference string
  // across many unrelated postings) — related_entries_total is the REAL count
  // sharing this reference; related_entries itself is capped server-side.
  // When related_entries_total is implausibly large for a normal 2-3-leg
  // post, render a caveat rather than presenting every row as definitely part
  // of this one transaction.
  related_entries: AdminTransactionRow[];
  related_entries_total: number;
}

export interface AdminTransactionFilters {
  type?: LedgerEntryType | '';
  account_type?: string;
  user_id?: string;
  search?: string;
  from?: string; // yyyy-mm-dd or RFC3339
  to?: string;
  min_amount_kobo?: number;
  max_amount_kobo?: number;
  limit?: number;
  offset?: number;
}

export interface AdminTransactionsPage {
  rows: AdminTransactionRow[];
  total: number;
  limit: number;
  offset: number;
}

function adminBase(): string {
  return `${apiRoot()}/api/finance/admin/transactions`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export async function listAdminTransactions(filters: AdminTransactionFilters = {}): Promise<AdminTransactionsPage> {
  const qs = new URLSearchParams();
  if (filters.type) qs.set('type', filters.type);
  if (filters.account_type) qs.set('account_type', filters.account_type);
  if (filters.user_id) qs.set('user_id', filters.user_id);
  if (filters.search) qs.set('search', filters.search);
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  if (filters.min_amount_kobo != null) qs.set('min_amount_kobo', String(filters.min_amount_kobo));
  if (filters.max_amount_kobo != null) qs.set('max_amount_kobo', String(filters.max_amount_kobo));
  qs.set('limit', String(filters.limit ?? 50));
  qs.set('offset', String(filters.offset ?? 0));

  const res = await fetch(`${adminBase()}?${qs.toString()}`, { cache: 'no-store', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  return {
    rows: Array.isArray(body?.rows) ? body.rows : [],
    total: typeof body?.total === 'number' ? body.total : 0,
    limit: typeof body?.limit === 'number' ? body.limit : (filters.limit ?? 50),
    offset: typeof body?.offset === 'number' ? body.offset : (filters.offset ?? 0),
  };
}

/** Comprehensive single-transaction detail, incl. every other ledger_entries
 * row sharing the same reference (the transaction's other leg(s)). */
export async function getAdminTransaction(id: string): Promise<AdminTransactionDetail> {
  const res = await fetch(`${adminBase()}/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  return body.transaction as AdminTransactionDetail;
}
