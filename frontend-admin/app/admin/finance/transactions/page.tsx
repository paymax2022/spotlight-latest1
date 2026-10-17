'use client';

// Centralized, read-only admin "Transactions" console. Lists EVERY ledger_entries
// row across every module (there is no per-module transactions table — this is
// the only source of truth for money movement). RBAC: finance.admin.transactions.view.
//
// Service purchased / Sub service / Category / Sub category / Payment method /
// Payment status are the REAL per-module detail resolved server-side (see
// backend/internal/app/admin_transaction_resolvers.go) — blank ("—") whenever
// no wired resolver recognizes this transaction's reference yet. Reference and
// "Source (inferred)" — a best-effort guess parsed server-side from the
// reference string — live on the transaction's Details page, not this table.
// Rows with no user (standing/system accounts — commission pots, clearing
// accounts, etc.) are shown as "System: <account type>", never dropped.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  listAdminTransactions,
  listAdminTransactionModules,
  getAdminTransactionsSummary,
  formatKobo,
  type AdminTransactionRow,
  type AdminTransactionModule,
  type AdminTransactionsSummary,
  type LedgerEntryType,
} from '@/services/transactionsAdminService';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { DailyVolumeChart } from '@/components/ui/DailyVolumeChart';

const PAGE_SIZE = 50;
const TYPES: Array<'' | LedgerEntryType> = ['', 'CREDIT', 'DEBIT', 'REVERSAL_CREDIT', 'REVERSAL_DEBIT'];
const ALL_TAB_KEY = '';

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function userCell(row: AdminTransactionRow): string {
  if (row.user_id) return row.user_name || row.user_email || row.user_id;
  return `System: ${row.account_type}`;
}

// ledger_entries only records money movement that ALREADY happened — a
// genuinely failed attempt never posts a row at all (this codebase's rails
// are fail-closed), and a still-pending one hasn't posted yet either. So this
// is the only status the shared ledger itself can honestly report: whether
// this row is a normal forward movement, or a REVERSAL undoing an earlier
// one. It is NOT "Pending"/"Failed" — those require the specific module's own
// order/transaction table, built module-by-module (see the per-module detail
// work on the transaction detail page).
function ledgerStatusLabel(type: LedgerEntryType): string {
  if (type === 'REVERSAL_CREDIT' || type === 'REVERSAL_DEBIT') return 'Reversed';
  return 'Posted';
}

const selectStyle: CSSProperties = {
  padding: '0.45rem 0.6rem',
  borderRadius: '0.4rem',
  border: `1px solid ${colors.border}`,
  fontSize: '0.85rem',
  background: colors.card,
  color: colors.text,
};

const labelStyle: CSSProperties = {
  fontSize: '0.8rem',
  color: colors.text,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

export default function AdminTransactionsPage() {
  const [rows, setRows] = useState<AdminTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<'' | LedgerEntryType>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmountNaira, setMinAmountNaira] = useState('');
  const [maxAmountNaira, setMaxAmountNaira] = useState('');

  // Dashboard: one tab per wired module (fetched, never hand-duplicated) plus
  // "All". Selecting a tab scopes BOTH the chart and the table below it to
  // that module's reference convention.
  const [modules, setModules] = useState<AdminTransactionModule[]>([]);
  const [activeModule, setActiveModule] = useState(ALL_TAB_KEY);
  const [summary, setSummary] = useState<AdminTransactionsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    listAdminTransactionModules().then(setModules).catch(() => setModules([]));
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const s = await getAdminTransactionsSummary({
        module: activeModule || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setSummary(s);
    } catch (e) {
      setSummaryError(String(e));
    } finally {
      setSummaryLoading(false);
    }
  }, [activeModule, from, to]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listAdminTransactions({
        type: type || undefined,
        search: search || undefined,
        module: activeModule || undefined,
        from: from || undefined,
        to: to || undefined,
        min_amount_kobo: minAmountNaira ? Math.round(parseFloat(minAmountNaira) * 100) : undefined,
        max_amount_kobo: maxAmountNaira ? Math.round(parseFloat(maxAmountNaira) * 100) : undefined,
        limit: PAGE_SIZE,
        offset: off,
      });
      setRows(page.rows);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [type, search, activeModule, from, to, minAmountNaira, maxAmountNaira]);

  // Any filter (including the active tab) change resets to the first page.
  useEffect(() => { void load(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, search, activeModule, from, to, minAmountNaira, maxAmountNaira]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, total);
  const tabItems = [{ key: ALL_TAB_KEY, label: 'All' }, ...modules.map((m) => ({ key: m.key, label: m.label }))];

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle="Every ledger_entries row across every module — the only source of truth for money movement (no per-module transactions table exists). Read-only. RBAC: finance.admin.transactions.view."
        actions={<Button variant="outline" onClick={() => { void load(offset); void loadSummary(); }}>Refresh</Button>}
      />

      <Tabs items={tabItems} active={activeModule} onChange={setActiveModule} />

      <Card
        title={`Daily volume — ${tabItems.find((t) => t.key === activeModule)?.label ?? 'All'}`}
        style={{ marginBottom: 16 }}
      >
        {summaryError ? (
          <p style={{ color: colors.danger }}>{summaryError}</p>
        ) : summaryLoading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : !summary || summary.days.length === 0 ? (
          <p style={{ color: colors.muted }}>No transactions in this range.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: colors.muted }}>Total transactions</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.text }}>{summary.total_count.toLocaleString('en-NG')}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: colors.muted }}>Total amount</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.text }}>{formatKobo(summary.total_amount_kobo)}</div>
              </div>
            </div>
            <DailyVolumeChart days={summary.days} />
            <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.5rem' }}>
              Each day&rsquo;s count and amount reflect real transactions (one per ledger reference), not raw ledger
              rows — a balanced double-entry post shares one reference across 2+ rows and is never double-counted.
              Hover a bar for its exact figures.
            </p>
          </>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={labelStyle}>
            Type
            <select style={selectStyle} value={type} onChange={(e) => setType(e.target.value as '' | LedgerEntryType)}>
              {TYPES.map((t) => <option key={t || 'all'} value={t}>{t || 'All'}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            From
            <input type="date" style={selectStyle} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={labelStyle}>
            To
            <input type="date" style={selectStyle} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Min amount (₦)
            <Input type="number" min={0} value={minAmountNaira} onChange={(e) => setMinAmountNaira(e.target.value)} style={{ width: 120 }} />
          </label>
          <label style={labelStyle}>
            Max amount (₦)
            <Input type="number" min={0} value={maxAmountNaira} onChange={(e) => setMaxAmountNaira(e.target.value)} style={{ width: 120 }} />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 220px' }}>
            Search (reference or user name/email)
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="fx:convert:… or jane@…" />
          </label>
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading transactions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No transactions match this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1320 }}>
              <thead>
                <tr>
                  <th style={thCell}>Date</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell} title="Derived from ledger entry type only: Posted = a normal forward movement, Reversed = a REVERSAL_* undoing an earlier one. This is NOT Pending/Failed — the ledger only records money movement that already happened.">
                    Ledger status *
                  </th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>User</th>
                  <th style={thCell} title="The module this transaction belongs to, e.g. “Utility Bills”. Blank when no per-module resolver recognizes this transaction's reference yet.">
                    Service purchased
                  </th>
                  <th style={thCell} title="The category within that module, e.g. “Airtime”.">
                    Sub service
                  </th>
                  <th style={thCell} title="The biller/provider/brand transacted with, e.g. “MTN”.">
                    Category
                  </th>
                  <th style={thCell} title="The specific product/variant bought, e.g. “MTN Airtime ₦500”.">
                    Sub category
                  </th>
                  <th style={thCell}>Payment method</th>
                  <th style={thCell} title="The REAL per-module status (e.g. successful/failed/ACTIVE) resolved from that module's own table — not the generic ledger Posted/Reversed.">
                    Payment status
                  </th>
                  <th style={thCell}></th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const md = r.module_detail;
                  return (
                  <tr key={r.id}>
                    <td style={tdCell}>{fmtDate(r.created_at)}</td>
                    <td style={tdCell}>{r.type}</td>
                    <td style={tdCell}><StatusBadge status={ledgerStatusLabel(r.type)} /></td>
                    <td style={tdCell}>{formatKobo(r.amount_kobo)}</td>
                    <td style={tdCell}>{userCell(r)}</td>
                    <td style={tdCell}>{md?.service_purchased ?? '—'}</td>
                    <td style={tdCell}>{md?.sub_service ?? '—'}</td>
                    <td style={tdCell}>{md?.category ?? '—'}</td>
                    <td style={tdCell}>{md?.sub_category ?? '—'}</td>
                    <td style={tdCell}>{md?.payment_method ?? '—'}</td>
                    <td style={tdCell}>{md ? <StatusBadge status={md.status} /> : '—'}</td>
                    <td style={tdCell}><Link href={`/admin/finance/transactions/${r.id}`} style={{ color: colors.info }}>Details →</Link></td>
                    <td style={tdCell}>
                      <Link href={`/admin/finance/transactions/${r.id}#distribution`} style={{ color: colors.info }} title="See how this transaction's money split between Spotlight, the service provider, and any referral reward.">
                        Money flow →
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.75rem' }}>
          * &ldquo;Ledger status&rdquo; reflects only what the shared ledger can know: Posted (a normal movement) or
          Reversed (undone by a REVERSAL_*). It is never Pending or Failed on its own — that finer detail is what
          &ldquo;Payment status&rdquo; carries, when a per-module resolver recognizes this transaction (see the
          &ldquo;Service purchased&rdquo; group of columns). Reference and Source (inferred) — the best-effort module
          guess parsed from the reference string — have moved to the transaction&rsquo;s own Details page rather than
          cluttering this table.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: colors.muted }}>
            {total > 0 ? `Showing ${rangeStart}–${rangeEnd} of ${total}` : 'No results'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="outline" sm disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button variant="outline" sm disabled={offset + rows.length >= total || loading} onClick={() => void load(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </Page>
  );
}
