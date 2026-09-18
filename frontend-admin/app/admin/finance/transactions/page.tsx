'use client';

// Centralized, read-only admin "Transactions" console. Lists EVERY ledger_entries
// row across every module (there is no per-module transactions table — this is
// the only source of truth for money movement). RBAC: finance.admin.transactions.view.
//
// "Source (inferred)" is a best-effort guess parsed server-side from the
// reference string (SPLIT_PART on ':') — it is NEVER an authoritative module
// field, since reference-naming conventions are inconsistent across modules.
// Rows with no user (standing/system accounts — commission pots, clearing
// accounts, etc.) are shown as "System: <account type>", never dropped.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  listAdminTransactions,
  formatKobo,
  type AdminTransactionRow,
  type LedgerEntryType,
} from '@/services/transactionsAdminService';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;
const TYPES: Array<'' | LedgerEntryType> = ['', 'CREDIT', 'DEBIT', 'REVERSAL_CREDIT', 'REVERSAL_DEBIT'];

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

  const load = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listAdminTransactions({
        type: type || undefined,
        search: search || undefined,
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
  }, [type, search, from, to, minAmountNaira, maxAmountNaira]);

  // Any filter change resets to the first page.
  useEffect(() => { void load(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, search, from, to, minAmountNaira, maxAmountNaira]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, total);

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle="Every ledger_entries row across every module — the only source of truth for money movement (no per-module transactions table exists). Read-only. RBAC: finance.admin.transactions.view."
        actions={<Button variant="outline" onClick={() => void load(offset)}>Refresh</Button>}
      />

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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={thCell}>Date</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>User</th>
                  <th style={thCell}>Reference</th>
                  <th style={thCell} title="Best-effort guess parsed from the reference string (SPLIT_PART on ':'). NOT an authoritative module field.">
                    Source (inferred) *
                  </th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>{fmtDate(r.created_at)}</td>
                    <td style={tdCell}>{r.type}</td>
                    <td style={tdCell}>{formatKobo(r.amount_kobo)}</td>
                    <td style={tdCell}>{userCell(r)}</td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.reference}</td>
                    <td style={tdCell} title="Best-effort guess parsed from the reference string — not a real schema field.">
                      {r.source_inferred || '—'}
                    </td>
                    <td style={tdCell}><Link href={`/admin/finance/transactions/${r.id}`} style={{ color: colors.info }}>Details →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.75rem' }}>
          * &ldquo;Source (inferred)&rdquo; is parsed from the reference string server-side and is a best-effort guess only —
          reference-naming conventions differ across modules (colon-namespaced, dash-prefixed, or opaque UUIDs with no
          separator). It is never a guaranteed-accurate module identifier.
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
