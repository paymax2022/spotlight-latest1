'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  formatKobo,
  listAdminTransactions,
  type AdminTransactionRow,
  type LedgerEntryType,
} from '@/services/transactionsAdminService';
import { Card, Button, colors } from '@/components/ui/vuexy';

const PAGE_SIZE = 25;

const TYPE_OPTIONS: Array<{ value: LedgerEntryType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'CREDIT', label: 'CREDIT' },
  { value: 'DEBIT', label: 'DEBIT' },
  { value: 'REVERSAL_CREDIT', label: 'REVERSAL_CREDIT' },
  { value: 'REVERSAL_DEBIT', label: 'REVERSAL_DEBIT' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-NG');
}

/**
 * listAdminTransactions throws a plain Error (no status field), with message
 * body.error / body.message or `Request failed (<status>)`. So a 403 is
 * detected from "(403)" in the message or the backend's permission-denied
 * wording ("forbidden" / "permission").
 */
function isForbidden(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return /\(403\)/.test(msg) || /forbidden|permission denied|insufficient permission/i.test(msg);
}

const th = { textAlign: 'left' as const, padding: '6px 8px', color: colors.muted, fontWeight: 600 };
const td = { padding: '6px 8px' };

/**
 * Read-only ledger transactions panel for the admin user profile. Amounts are
 * integer kobo, displayed via formatKobo only (never negated; REVERSAL_* types
 * are shown by their plain label). Contains no mutation controls.
 */
export function TransactionsPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<AdminTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState<LedgerEntryType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await listAdminTransactions({
        user_id: userId,
        limit: PAGE_SIZE,
        offset,
        ...(type ? { type } : {}),
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      if (isForbidden(err)) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading transactions failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId, offset, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading transactions…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ fontSize: 13, color: colors.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
          Type
          <select
            value={type}
            onChange={(e) => {
              setOffset(0);
              setType(e.target.value as LedgerEntryType | '');
            }}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No transactions</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Type</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Description</th>
                  <th style={th}>Account</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>
                      <Link href={`/admin/finance/transactions/${t.id}`}>{t.type}</Link>
                    </td>
                    <td style={td}>{formatKobo(t.amount_kobo)}</td>
                    <td style={td}>{t.description ?? ''}</td>
                    <td style={td}>{t.account_type}</td>
                    <td style={td}>{formatDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="outline" sm disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button variant="outline" sm disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
          <span style={{ fontSize: 12, color: colors.muted }}>{total} total</span>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="transactions-panel">
      <Card title="Transactions">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
