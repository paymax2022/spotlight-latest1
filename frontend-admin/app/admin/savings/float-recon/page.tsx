'use client';

import { useEffect, useState } from 'react';
import { getFloatRecon, formatNaira } from '@/services/savingsAdminService';
import type { FloatRecon } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../_ui';

export default function FloatReconPage() {
  const [data, setData] = useState<FloatRecon | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFloatRecon()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Float reconciliation" subtitle="Ledger projections vs custody float per savings product. Deltas must trend to zero." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SavingsTabs active="float" />
      <DisclosureNote>NL-8 — wallet / sub-balances are projections of the immutable double-entry ledger; balances are never updated directly. A non-zero delta is a reconciliation break requiring a reversing-entry correction, never a balance edit.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reconciliation data.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Ledger total" value={formatNaira(data.total_ledger_kobo)} accent="#340075" />
              <Kpi label="Custody total" value={formatNaira(data.total_custody_kobo)} />
              <Kpi label="Total delta" value={formatNaira(data.total_delta_kobo)} sub={data.total_delta_kobo === 0 ? 'Balanced' : 'Break open'} accent={data.total_delta_kobo === 0 ? '#15803d' : '#b91c1c'} />
              <Kpi label="Generated" value={timeAgo(data.generated_at)} />
            </div>

            <Card title="Reconciliation by product">
              {data.lines.length === 0 ? <p style={{ color: '#6b7280' }}>No lines.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Product</th><th style={th()}>Ledger</th><th style={th()}>Custody</th><th style={th()}>Delta</th><th style={th()}>Status</th><th style={th()}>As of</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={td()}><Badge status={l.product} /></td>
                        <td style={td()}>{formatNaira(l.ledger_balance_kobo)}</td>
                        <td style={td()}>{formatNaira(l.custody_balance_kobo)}</td>
                        <td style={{ ...td(), color: l.delta_kobo === 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{formatNaira(l.delta_kobo)}</td>
                        <td style={td()}><Badge status={l.status} /></td>
                        <td style={td()}>{timeAgo(l.as_of)}</td>
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
