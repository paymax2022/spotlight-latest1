'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getReconciliation, formatNaira } from '@/services/referralAdminOpsService';
import type { Reconciliation } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, StateBlock } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Finance — Reconciliation"
        subtitle="Reward ledger ↔ wallet credit ↔ payout settlement (A-FIN-02). Variances flagged for investigation."
        action={<Link href="/admin/referral/finance" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Payouts</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Ledger accrued" value={formatNaira(data.total_accrued_kobo)} />
              <Kpi label="Wallet credited" value={formatNaira(data.total_credited_kobo)} />
              <Kpi label="Payout settled" value={formatNaira(data.total_settled_kobo)} />
              <Kpi label="Unmatched" value={formatNaira(data.unmatched_kobo)} accent={data.unmatched_kobo > 0 ? '#b91c1c' : '#15803d'} />
            </div>

            <Card title="Daily reconciliation" right={
              <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
                <option value="all">All rows</option>
                <option value="matched">Matched</option>
                <option value="variance">Variance only</option>
                <option value="investigating">Investigating</option>
              </select>
            }>
              {rows.length === 0 ? <p style={{ color: '#6b7280' }}>No rows match.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Date</th><th style={th()}>Accrued</th><th style={th()}>Credited</th>
                    <th style={th()}>Settled</th><th style={th()}>Variance</th><th style={th()}>Status</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={td()}>{r.date}</td>
                        <td style={td()}>{formatNaira(r.ledger_accrued_kobo)}</td>
                        <td style={td()}>{formatNaira(r.wallet_credited_kobo)}</td>
                        <td style={td()}>{formatNaira(r.payout_settled_kobo)}</td>
                        <td style={{ ...td(), color: r.variance_kobo !== 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>{formatNaira(r.variance_kobo)}</td>
                        <td style={td()}><Badge status={r.status === 'matched' ? 'resolved' : r.status === 'investigating' ? 'open' : 'high'} label={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
