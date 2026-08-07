'use client';

import { useEffect, useState } from 'react';
import { getOverview } from '@/services/fxAdminService';
import type { FxOverview } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Kpi, Badge, money } from './_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
        action={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <FxTabs active="overview" />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {loading || !data ? (
        <p style={{ color: colors.muted }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV (24h)" value={money(data.gmvUsdCents, 'USD')} sub="USD-equivalent" />
            <Kpi label="FX margin (24h)" value={money(data.marginUsdCents, 'USD')} accent={colors.info} sub="Spread captured" />
            <Kpi label="Transactions (24h)" value={data.txCount24h.toLocaleString('en-NG')} />
            <Kpi label="Success rate" value={`${data.successRate}%`} accent={colors.success} />
            <Kpi label="Failure rate" value={`${data.failureRate}%`} accent={data.failureRate > 3 ? colors.danger : colors.muted} />
            <Kpi label="Float health" value={`${data.floatHealthPct}%`} accent={data.floatHealthPct < 80 ? colors.warning : colors.success} />
            <Kpi label="Recon breaks" value={String(data.reconBreaks)} accent={data.reconBreaks ? colors.warning : colors.success} />
            <Kpi label="Open incidents" value={String(data.openIncidents)} accent={data.openIncidents ? colors.danger : colors.success} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Routing mix by provider">
              {data.providerMix.map((p) => (
                <div key={p.provider} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{p.provider}</strong>
                    <span>{p.share}% · {money(p.volumeUsdCents, 'USD')}</span>
                  </div>
                  <div style={{ background: colors.border, borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${p.share}%`, height: '100%', background: colors.info, borderRadius: 9999 }} />
                  </div>
                </div>
              ))}
            </Card>

            <Card title="Provider breaker status">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <tbody>
                  {data.breakers.map((b) => (
                    <tr key={b.provider} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong style={{ textTransform: 'capitalize' }}>{b.provider}</strong></td>
                      <td style={{ ...tdCell, textAlign: 'right' }}><Badge status={b.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>A half-open breaker is probing recovery after consecutive failures.</p>
            </Card>
          </div>

          <Card title="Top corridors (24h)">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Corridor</th><th style={thCell}>Volume</th><th style={thCell}>Margin</th><th style={thCell}>Success</th>
                </tr>
              </thead>
              <tbody>
                {data.topCorridors.map((c) => (
                  <tr key={c.corridor} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{c.corridor}</strong></td>
                    <td style={tdCell}>{money(c.volumeUsdCents, 'USD')}</td>
                    <td style={tdCell}>{money(c.marginUsdCents, 'USD')}</td>
                    <td style={tdCell}>{c.successRate}%</td>
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
