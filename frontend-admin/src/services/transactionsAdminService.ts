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

// Per-module detail resolved server-side from a transaction's reference —
// see backend/internal/app/admin_transaction_resolvers.go. Null whenever no
// wired resolver's reference pattern matches (most module/reference
// combinations today — resolvers exist for a growing subset: marketplace
// boosts, insurance premiums, FX conversions, utility bills). A null here is
// not an error — render an honest "no resolver yet" note rather than hiding
// the absence.
//
// Field taxonomy (module hierarchy): service_purchased is the MODULE
// ("Utility Bills", "Insurance", "FX", "Marketplace"). sub_service is the
// category WITHIN that module ("Airtime", "Premium Payment"). category is
// the biller/provider/brand transacted with ("MTN") — null if the module has
// none. sub_category is the specific product/variant bought ("MTN Airtime
// ₦500") — null when no finer-grained real column backs it.
export interface AdminModuleTransactionDetail {
  module: string;
  service_purchased: string;
  sub_service: string;
  category: string | null;
  sub_category: string | null;
  service_bought: string;
  payment_method: string;
  status: string;
  provider: string | null;
  merchant: string | null;
}

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
  // Populated on BOTH the list and the detail view — see
  // AdminModuleTransactionDetail above.
  module_detail: AdminModuleTransactionDetail | null;
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
  // Sum of related_entries that landed in a KNOWN platform-revenue standing
  // account (commission, paymax_revenue, fx_spread_income, placement_revenue,
  // edtech_fees_vault, trading_fee_income). A REAL derived figure, not a
  // guess — but null does not mean "zero commission was charged"; it means no
  // such leg was present among related_entries (which itself may be
  // truncated — see related_entries_total).
  commission_kobo: number | null;
  // module_detail is inherited from AdminTransactionRow above.
}

export interface AdminTransactionFilters {
  type?: LedgerEntryType | '';
  account_type?: string;
  user_id?: string;
  search?: string;
  // Narrows to one dashboard module tab (see AdminTransactionModule) — the
  // SAME reference-pattern matching used server-side by the resolver that
  // fills module_detail, so a tab and its rows' resolved module always agree.
  // Empty/omitted means every row, resolved or not — the "All" tab.
  module?: string;
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

// One dashboard tab. `key` matches ModuleTransactionDetail.module exactly —
// see backend/internal/finance/ledger/admin_transaction_modules.go, the
// single source of truth this list is fetched from (never hand-duplicated
// here, so a new resolver shows up as a new tab automatically).
export interface AdminTransactionModule {
  key: string;
  label: string;
}

export interface AdminTransactionsSummaryDay {
  day: string; // YYYY-MM-DD, UTC
  count: number;
  amount_kobo: number;
}

export interface AdminTransactionsSummary {
  days: AdminTransactionsSummaryDay[];
  total_count: number;
  total_amount_kobo: number;
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
  if (filters.module) qs.set('module', filters.module);
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

/** The fixed list of dashboard module tabs — fetched, never hand-duplicated,
 * so a new backend resolver appears as a new tab automatically. */
export async function listAdminTransactionModules(): Promise<AdminTransactionModule[]> {
  const res = await fetch(`${adminBase()}/modules`, { cache: 'no-store', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  return Array.isArray(body?.modules) ? body.modules : [];
}

/** Daily transaction-volume series backing a module tab's dashboard chart.
 * `module` empty means every transaction (the "All" tab). */
export async function getAdminTransactionsSummary(params: { module?: string; from?: string; to?: string }): Promise<AdminTransactionsSummary> {
  const qs = new URLSearchParams();
  if (params.module) qs.set('module', params.module);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);

  const res = await fetch(`${adminBase()}/summary?${qs.toString()}`, { cache: 'no-store', headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  return body.summary as AdminTransactionsSummary;
}

// ── Money-flow / stakeholder distribution ────────────────────────────────────
//
// There is no single cross-module "commission table" schema in this codebase
// (utility has commission_earnings, referrals have their own reward-ledger
// tables, restaurant/association have revenue_splits — none share a shape).
// What every module DOES share is the ledger itself: every other leg of a
// transaction's balanced double-entry post is already returned as
// `related_entries`. This relabels those SAME rows with a stakeholder name
// instead of raw ledger jargon (account type), so "where did this money go"
// reads as Spotlight / Service Provider / Referrer / Customer rather than
// paymax_revenue / provider_clearing / user_wallet.
//
// BEST-EFFORT, like source_inferred: a user_wallet leg belonging to a
// DIFFERENT user than the transaction's own payer is inferred to be a
// referral reward (the only reason this codebase credits a stranger's wallet
// off of someone else's payment reference) — it is not a guaranteed-accurate
// claim, since nothing on the ledger row itself states "this is a referral".
const REVENUE_ACCOUNT_TYPES = new Set([
  'commission', 'paymax_revenue', 'fx_spread_income',
  'placement_revenue', 'edtech_fees_vault', 'trading_fee_income',
]);

export interface StakeholderLeg {
  label: string;
  caveat?: string;
}

export function stakeholderLabel(row: AdminTransactionRow, mainTransactionUserId: string | null): StakeholderLeg {
  if (REVENUE_ACCOUNT_TYPES.has(row.account_type)) {
    return { label: 'Spotlight' };
  }
  if (row.account_type === 'provider_clearing') {
    return { label: 'Service Provider' };
  }
  if (row.account_type === 'referral_reward_expense') {
    return { label: 'Referral Program', caveat: 'The expense-side clearing leg — the referrer’s own credit is the user_wallet leg below, if present.' };
  }
  if (row.account_type === 'user_wallet') {
    if (row.user_id && mainTransactionUserId && row.user_id === mainTransactionUserId) {
      return { label: 'Customer (Referred)' };
    }
    if (row.user_id) {
      return { label: 'Referrer', caveat: 'Best-effort: a different user’s wallet credited off this reference — inferred as a referral reward, not a guaranteed-accurate claim.' };
    }
  }
  return { label: 'Spotlight (internal clearing)', caveat: `Standing account type "${row.account_type}" — a float/clearing account, not a paid-out stakeholder.` };
}
