'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getReconciliation, formatNaira } from '@/services/referralAdminOpsService';
import type { Reconciliation } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['open', 'pending', 'high'].includes(s)) return colors.warning;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

export default function ReconciliationPage() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReconciliation()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = (data?.rows ?? []).filter((r) => filter === 'all' ? true : filter === 'variance' ? r.variance_kobo !== 0 : r.status === filter);

  return (
    <Page>
      <PageHeader
        title="Finance — Reconciliation"
        subtitle="Reward ledger ↔ wallet credit ↔ payout settlement (A-FIN-02). Variances flagged for investigation."
        actions={<Link href="/admin/referral/finance" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Payouts</Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Ledger accrued" value={formatNaira(data.total_accrued_kobo)} />
            <Kpi label="Wallet credited" value={formatNaira(data.total_credited_kobo)} />
            <Kpi label="Payout settled" value={formatNaira(data.total_settled_kobo)} />
            <Kpi label="Unmatched" value={formatNaira(data.unmatched_kobo)} accent={data.unmatched_kobo > 0 ? colors.danger : colors.success} />
          </div>

          <Card title="Daily reconciliation">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All rows</option>
                <option value="matched">Matched</option>
                <option value="variance">Variance only</option>
                <option value="investigating">Investigating</option>
              </select>
            </div>
            {rows.length === 0 ? <p style={{ color: colors.muted }}>No rows match.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Date</th><th style={thCell}>Accrued</th><th style={thCell}>Credited</th>
                    <th style={thCell}>Settled</th><th style={thCell}>Variance</th><th style={thCell}>Status</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}>{r.date}</td>
                        <td style={tdCell}>{formatNaira(r.ledger_accrued_kobo)}</td>
                        <td style={tdCell}>{formatNaira(r.wallet_credited_kobo)}</td>
                        <td style={tdCell}>{formatNaira(r.payout_settled_kobo)}</td>
                        <td style={{ ...tdCell, color: r.variance_kobo !== 0 ? colors.danger : colors.success, fontWeight: 600 }}>{formatNaira(r.variance_kobo)}</td>
                        <td style={tdCell}><StatusBadge status={r.status === 'matched' ? 'resolved' : r.status === 'investigating' ? 'open' : 'high'} label={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
