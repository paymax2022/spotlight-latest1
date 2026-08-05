'use client';

import { useEffect, useState } from 'react';
import { getAnalytics } from '@/services/fxAdminService';
import type { FxAnalytics } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, money } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxAnalyticsPage() {
  const [data, setData] = useState<FxAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); try { setData(await getAnalytics()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Analytics & Reports" subtitle="Margin, routing efficiency, provider reliability and retention." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="analytics" />

      {loading || !data ? <p style={{ color: colors.muted }}>Loading…</p> : (
        <>
          <Card title="FX margin by corridor">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Corridor</th><th style={thCell}>Volume</th><th style={thCell}>Margin</th><th style={thCell}>Margin (bps)</th><th style={{ ...thCell, width: '35%' }}>Share</th></tr></thead>
              <tbody>
                {data.marginByCorridor.map((m) => {
                  const max = Math.max(...data.marginByCorridor.map((x) => x.marginUsdCents), 1);
                  return (
                    <tr key={m.corridor} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong>{m.corridor}</strong></td>
                      <td style={tdCell}>{money(m.volumeUsdCents, 'USD')}</td>
                      <td style={tdCell}>{money(m.marginUsdCents, 'USD')}</td>
                      <td style={tdCell}>{m.marginBps}</td>
                      <td style={tdCell}><div style={{ background: colors.border, borderRadius: 9999, height: 8 }}><div style={{ width: `${(m.marginUsdCents / max) * 100}%`, height: '100%', background: colors.info, borderRadius: 9999 }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Provider reliability scorecard">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Provider</th><th style={thCell}>Success</th><th style={thCell}>Latency</th><th style={thCell}>Failovers</th><th style={thCell}>Uptime</th></tr></thead>
                <tbody>
                  {data.providerReliability.map((p) => (
                    <tr key={p.provider} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ ...tdCell, textTransform: 'capitalize' }}><strong>{p.provider}</strong></td>
                      <td style={tdCell}>{p.successRate}%</td>
                      <td style={tdCell}>{p.avgLatencyMs} ms</td>
                      <td style={tdCell}>{p.failovers}</td>
                      <td style={tdCell}>{p.uptime}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Routing efficiency (chosen vs best)">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Corridor</th><th style={thCell}>Gap (bps)</th><th style={thCell}>Optimal %</th></tr></thead>
                <tbody>
                  {data.routingEfficiency.map((r) => (
                    <tr key={r.corridor} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong>{r.corridor}</strong></td>
                      <td style={{ ...tdCell, color: r.chosenVsBestBps > 4 ? colors.warning : colors.success }}>{r.chosenVsBestBps.toFixed(1)}</td>
                      <td style={tdCell}>{r.optimalPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card title="Customer retention cohorts">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Cohort</th><th style={thCell}>M1</th><th style={thCell}>M2</th><th style={thCell}>M3</th></tr></thead>
              <tbody>
                {data.retentionCohorts.map((c) => (
                  <tr key={c.cohort} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdCell}><strong>{c.cohort}</strong></td>
                    <td style={tdCell}>{c.m1}%</td>
                    <td style={tdCell}>{c.m2}%</td>
                    <td style={tdCell}>{c.m3 ? `${c.m3}%` : '—'}</td>
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
