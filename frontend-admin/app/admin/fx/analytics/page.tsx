'use client';

import { useEffect, useState } from 'react';
import { getAnalytics } from '@/services/fxAdminService';
import type { FxAnalytics } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, btn, th, td, money } from '../_ui';

export default function FxAnalyticsPage() {
  const [data, setData] = useState<FxAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); try { setData(await getAnalytics()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Analytics & Reports" subtitle="Margin, routing efficiency, provider reliability and retention." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="analytics" />

      {loading || !data ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <>
          <Card title="FX margin by corridor">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Corridor</th><th style={th()}>Volume</th><th style={th()}>Margin</th><th style={th()}>Margin (bps)</th><th style={{ ...th(), width: '35%' }}>Share</th></tr></thead>
              <tbody>
                {data.marginByCorridor.map((m) => {
                  const max = Math.max(...data.marginByCorridor.map((x) => x.marginUsdCents), 1);
                  return (
                    <tr key={m.corridor} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong>{m.corridor}</strong></td>
                      <td style={td()}>{money(m.volumeUsdCents, 'USD')}</td>
                      <td style={td()}>{money(m.marginUsdCents, 'USD')}</td>
                      <td style={td()}>{m.marginBps}</td>
                      <td style={td()}><div style={{ background: '#f3f4f6', borderRadius: 9999, height: 8 }}><div style={{ width: `${(m.marginUsdCents / max) * 100}%`, height: '100%', background: '#1d4ed8', borderRadius: 9999 }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Provider reliability scorecard">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Provider</th><th style={th()}>Success</th><th style={th()}>Latency</th><th style={th()}>Failovers</th><th style={th()}>Uptime</th></tr></thead>
                <tbody>
                  {data.providerReliability.map((p) => (
                    <tr key={p.provider} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ ...td(), textTransform: 'capitalize' }}><strong>{p.provider}</strong></td>
                      <td style={td()}>{p.successRate}%</td>
                      <td style={td()}>{p.avgLatencyMs} ms</td>
                      <td style={td()}>{p.failovers}</td>
                      <td style={td()}>{p.uptime}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Routing efficiency (chosen vs best)">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Corridor</th><th style={th()}>Gap (bps)</th><th style={th()}>Optimal %</th></tr></thead>
                <tbody>
                  {data.routingEfficiency.map((r) => (
                    <tr key={r.corridor} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong>{r.corridor}</strong></td>
                      <td style={{ ...td(), color: r.chosenVsBestBps > 4 ? '#d97706' : '#16a34a' }}>{r.chosenVsBestBps.toFixed(1)}</td>
                      <td style={td()}>{r.optimalPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card title="Customer retention cohorts">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Cohort</th><th style={th()}>M1</th><th style={th()}>M2</th><th style={th()}>M3</th></tr></thead>
              <tbody>
                {data.retentionCohorts.map((c) => (
                  <tr key={c.cohort} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{c.cohort}</strong></td>
                    <td style={td()}>{c.m1}%</td>
                    <td style={td()}>{c.m2}%</td>
                    <td style={td()}>{c.m3 ? `${c.m3}%` : '—'}</td>
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
