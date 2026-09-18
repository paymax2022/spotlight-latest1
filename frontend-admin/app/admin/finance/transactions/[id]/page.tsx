'use client';

// Comprehensive single-transaction detail. Every column on the ledger_entries
// row (including idempotency_key, raw metadata, currency) plus every OTHER
// row sharing the same reference — the other leg(s) of the same balanced
// double-entry movement — so an operator sees the whole transaction, not one
// isolated leg. RBAC: finance.admin.transactions.view (same as the list).

import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getAdminTransaction,
  formatKobo,
  type AdminTransactionDetail,
  type AdminTransactionRow,
} from '@/services/transactionsAdminService';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

function userLine(row: AdminTransactionRow | AdminTransactionDetail): string {
  if (!row.user_id) return `System: ${row.account_type}`;
  const parts = [row.user_name, row.user_email, row.user_phone].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : row.user_id;
}

const fieldRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4rem 0', borderBottom: `1px solid ${colors.border}` };
const fieldLabel: CSSProperties = { fontSize: '0.78rem', color: colors.muted, minWidth: 160 };
const fieldValue: CSSProperties = { fontSize: '0.85rem', color: colors.text, textAlign: 'right', wordBreak: 'break-all' };

export default function AdminTransactionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [detail, setDetail] = useState<AdminTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminTransaction(id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <Page>
      <PageHeader
        title="Transaction detail"
        subtitle="Every column on the ledger_entries row, plus every other row sharing this reference (the other leg(s) of the same movement). RBAC: finance.admin.transactions.view."
        actions={<Link href="/admin/finance/transactions"><Button variant="outline">Back to Transactions</Button></Link>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading || !detail ? (
        <Card><p style={{ color: colors.muted }}>{loading ? 'Loading…' : 'Not found.'}</p></Card>
      ) : (
        <>
          <Card title="Transaction" style={{ marginBottom: 16 }}>
            <div style={fieldRow}><span style={fieldLabel}>ID</span><span style={{ ...fieldValue, fontFamily: 'monospace' }}>{detail.id}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Type</span><span style={fieldValue}>{detail.type}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Amount</span><span style={fieldValue}>{formatKobo(detail.amount_kobo)} ({detail.currency})</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Created at</span><span style={fieldValue}>{fmtDate(detail.created_at)}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Reference</span><span style={{ ...fieldValue, fontFamily: 'monospace' }}>{detail.reference}</span></div>
            <div style={fieldRow} title="Best-effort guess parsed from the reference string — not a real schema field.">
              <span style={fieldLabel}>Source (inferred) *</span><span style={fieldValue}>{detail.source_inferred || '—'}</span>
            </div>
            <div style={fieldRow}><span style={fieldLabel}>Idempotency key</span><span style={{ ...fieldValue, fontFamily: 'monospace' }}>{detail.idempotency_key || '—'}</span></div>
            <div style={fieldRow} title="Sum of related entries landing in a known platform-revenue account (commission, paymax_revenue, fx_spread_income, placement_revenue, edtech_fees_vault, trading_fee_income). Not shown does not mean zero — see the caveat above if related entries were truncated.">
              <span style={fieldLabel}>Commission to Spotlight</span>
              <span style={fieldValue}>{detail.commission_kobo != null ? formatKobo(detail.commission_kobo) : 'No revenue leg found among related entries'}</span>
            </div>
            <div style={fieldRow}><span style={fieldLabel}>Description</span><span style={fieldValue}>{detail.description || '—'}</span></div>
            <div style={{ padding: '0.4rem 0' }}>
              <span style={{ ...fieldLabel, display: 'block', marginBottom: 4 }}>Metadata (raw)</span>
              <pre style={{ margin: 0, fontSize: '0.78rem', background: colors.card, border: `1px solid ${colors.border}`, borderRadius: '0.4rem', padding: '0.6rem', overflowX: 'auto' }}>
                {detail.metadata ? JSON.stringify(detail.metadata, null, 2) : '—'}
              </pre>
            </div>
          </Card>

          <Card title="Account & user" style={{ marginBottom: 16 }}>
            <div style={fieldRow}><span style={fieldLabel}>Account ID</span><span style={{ ...fieldValue, fontFamily: 'monospace' }}>{detail.account_id}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Account type</span><span style={fieldValue}>{detail.account_type}</span></div>
            <div style={fieldRow}>
              <span style={fieldLabel}>User</span>
              <span style={fieldValue}>
                {detail.user_id ? <Link href={`/admin/users/${detail.user_id}`} style={{ color: colors.info }}>{userLine(detail)}</Link> : userLine(detail)}
              </span>
            </div>
          </Card>

          <Card title="Related entries — the other leg(s) of this movement">
            {detail.related_entries_total > 4 && (
              <p style={{ color: colors.warning, fontSize: '0.8rem', marginTop: 0 }}>
                ⚠ {detail.related_entries_total} other rows share this exact reference — more than a normal 2–3-leg
                double-entry post. This reference string may be reused by a script across unrelated transactions
                (confirmed to happen for at least one seed helper in this codebase) rather than uniquely identifying
                this one movement. Treat the rows below as a lead to investigate, not a confirmed transaction group.
              </p>
            )}
            {detail.related_entries.length === 0 ? (
              <p style={{ color: colors.muted }}>No other ledger_entries row shares this reference.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Type</th>
                      <th style={thCell}>Amount</th>
                      <th style={thCell}>Account type</th>
                      <th style={thCell}>User</th>
                      <th style={thCell}>Created at</th>
                      <th style={thCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.related_entries.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}>{r.type}</td>
                        <td style={tdCell}>{formatKobo(r.amount_kobo)}</td>
                        <td style={tdCell}>{r.account_type}</td>
                        <td style={tdCell}>{userLine(r)}</td>
                        <td style={tdCell}>{fmtDate(r.created_at)}</td>
                        <td style={tdCell}><Link href={`/admin/finance/transactions/${r.id}`} style={{ color: colors.info }}>View →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.related_entries_total > detail.related_entries.length && (
                  <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.5rem' }}>
                    Showing {detail.related_entries.length} of {detail.related_entries_total} rows sharing this reference.
                  </p>
                )}
              </div>
            )}
          </Card>

          <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.75rem' }}>
            * &ldquo;Source (inferred)&rdquo; is parsed from the reference string server-side and is a best-effort guess only.
          </p>
        </>
      )}
    </Page>
  );
}
