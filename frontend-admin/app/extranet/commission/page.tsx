'use client';

import { useEffect, useState } from 'react';
import { getCommission, formatNaira } from '@/services/staysExtranetService';
import type { CommissionOverview } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, StateBlock, btn, th, td, pct } from '../_ui';

export default function CommissionPage() {
  const [data, setData] = useState<CommissionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getCommission()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxGmv = data ? Math.max(...data.by_rate_plan.map((r) => r.gmv_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Commission overview" subtitle="The Paymax commission applied to your bookings, and your net earnings — last 30 days." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="finance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Commission rate" value={pct(data.rate_pct)} />
              <Kpi label="GMV (30d)" value={formatNaira(data.gmv_30d_kobo)} sub="NGN" accent="#340075" />
              <Kpi label="Commission (30d)" value={formatNaira(data.commission_30d_kobo)} accent="#9a3412" />
              <Kpi label="Net earnings (30d)" value={formatNaira(data.net_30d_kobo)} accent="#15803d" />
            </div>

            <Card title="By rate plan (30d)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Rate plan</th><th style={th()}>GMV</th><th style={th()}>Commission</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.by_rate_plan.map((r) => (
                    <tr key={r.rate_plan_name}>
                      <td style={td()}>{r.rate_plan_name}</td>
                      <td style={td()}>{formatNaira(r.gmv_kobo)}</td>
                      <td style={td()}>{formatNaira(r.commission_kobo)}</td>
                      <td style={td()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 8, width: `${(r.gmv_kobo / maxGmv) * 100}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} />
                          <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>{pct(r.gmv_kobo / data.gmv_30d_kobo)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
