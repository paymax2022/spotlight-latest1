'use client';

import { useEffect, useState } from 'react';
import { getOverview } from '@/services/fxAdminService';
import type { FxOverview } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Kpi, Badge, btn, th, td, money } from './_ui';

export default function FxOverviewPage() {
  const [data, setData] = useState<FxOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getOverview()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="FX Orchestration"
        subtitle="Live volume, margin, routing and health across providers."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <FxTabs active="overview" />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading || !data ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV (24h)" value={money(data.gmvUsdCents, 'USD')} sub="USD-equivalent" />
            <Kpi label="FX margin (24h)" value={money(data.marginUsdCents, 'USD')} accent="#1d4ed8" sub="Spread captured" />
            <Kpi label="Transactions (24h)" value={data.txCount24h.toLocaleString('en-NG')} />
            <Kpi label="Success rate" value={`${data.successRate}%`} accent="#16a34a" />
            <Kpi label="Failure rate" value={`${data.failureRate}%`} accent={data.failureRate > 3 ? '#dc2626' : '#6b7280'} />
            <Kpi label="Float health" value={`${data.floatHealthPct}%`} accent={data.floatHealthPct < 80 ? '#d97706' : '#16a34a'} />
            <Kpi label="Recon breaks" value={String(data.reconBreaks)} accent={data.reconBreaks ? '#d97706' : '#16a34a'} />
            <Kpi label="Open incidents" value={String(data.openIncidents)} accent={data.openIncidents ? '#dc2626' : '#16a34a'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Routing mix by provider">
              {data.providerMix.map((p) => (
                <div key={p.provider} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{p.provider}</strong>
                    <span>{p.share}% · {money(p.volumeUsdCents, 'USD')}</span>
                  </div>
                  <div style={{ background: '#f3f4f6', borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${p.share}%`, height: '100%', background: '#1d4ed8', borderRadius: 9999 }} />
                  </div>
                </div>
              ))}
            </Card>

            <Card title="Provider breaker status">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <tbody>
                  {data.breakers.map((b) => (
                    <tr key={b.provider} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong style={{ textTransform: 'capitalize' }}>{b.provider}</strong></td>
                      <td style={{ ...td(), textAlign: 'right' }}><Badge status={b.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>A half-open breaker is probing recovery after consecutive failures.</p>
            </Card>
          </div>

          <Card title="Top corridors (24h)">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th()}>Corridor</th><th style={th()}>Volume</th><th style={th()}>Margin</th><th style={th()}>Success</th>
                </tr>
              </thead>
              <tbody>
                {data.topCorridors.map((c) => (
                  <tr key={c.corridor} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{c.corridor}</strong></td>
                    <td style={td()}>{money(c.volumeUsdCents, 'USD')}</td>
                    <td style={td()}>{money(c.marginUsdCents, 'USD')}</td>
                    <td style={td()}>{c.successRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
