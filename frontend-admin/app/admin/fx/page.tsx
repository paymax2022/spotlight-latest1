'use client';

import { useEffect, useState } from 'react';
import { getOverview } from '@/services/fxAdminService';
import type { FxOverview } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Kpi, Badge, money } from './_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const DASH = '—';
/** Backend sends null where it has no source; render that as "—", never as 0. */
const pct = (v: number | null | undefined) => (v == null ? DASH : `${v}%`);
const count = (v: number | null | undefined) => (v == null ? DASH : v.toLocaleString('en-NG'));

export default function FxOverviewPage() {
  const [data, setData] = useState<FxOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getOverview()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
          {data.generatedAt && (
            <p style={{ color: colors.muted, fontSize: '0.78rem', marginBottom: '0.75rem' }}>
              Last {data.windowHours ?? 24}h · read from the FX ledger at{' '}
              {new Date(data.generatedAt).toLocaleString()}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="GMV (24h)" value={money(data.gmvUsdCents, 'USD')} sub="USD-equivalent" />
            <Kpi label="FX margin (24h)" value={money(data.marginUsdCents, 'USD')} accent={colors.info} sub="Spread captured on settled rows" />
            <Kpi label="Transactions (24h)" value={count(data.txCount24h)} sub="Conversions, payouts, deposits" />
            <Kpi
              label="Success rate"
              value={pct(data.successRate)}
              accent={data.successRate == null ? colors.muted : colors.success}
              sub={data.successRate == null ? 'No terminal FX rows in 24h' : 'Conversions & payouts'}
            />
            <Kpi
              label="Failure rate"
              value={pct(data.failureRate)}
              accent={data.failureRate == null ? colors.muted : data.failureRate > 3 ? colors.danger : colors.muted}
              sub={data.failureRate == null ? 'No terminal FX rows in 24h' : 'Conversions & payouts'}
            />
            <Kpi
              label="Float health"
              value={pct(data.floatHealthPct)}
              accent={data.floatHealthPct == null ? colors.muted : data.floatHealthPct < 80 ? colors.warning : colors.success}
              sub={
                data.floatBuckets == null
                  ? 'No float buckets configured'
                  : `${data.floatBuckets} buckets · ${data.floatBelowLow ?? 0} below low-water`
              }
            />
            <Kpi
              label="Recon breaks"
              value={count(data.reconBreaks)}
              accent={data.reconBreaks == null ? colors.muted : data.reconBreaks ? colors.warning : colors.success}
              sub={data.reconBreaks == null ? 'Reconciliation not persisted yet' : undefined}
            />
            <Kpi
              label="Open incidents"
              value={count(data.openIncidents)}
              accent={data.openIncidents == null ? colors.muted : data.openIncidents ? colors.danger : colors.success}
              sub={data.openIncidents == null ? 'No incident register' : undefined}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Card title="Routing mix by provider">
              {data.providerMix.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No routed volume in this window.</p>
              ) : data.providerMix.map((p) => (
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
              {data.breakers.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
                  Circuit-breaker state is not reported by the backend yet.
                </p>
              ) : (
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
              )}
              <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>A half-open breaker is probing recovery after consecutive failures.</p>
            </Card>
          </div>

          <Card title="Top corridors (24h)">
            {data.topCorridors.length === 0 ? (
              <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No conversions or payouts in this window.</p>
            ) : (
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
                      <td style={tdCell}>{pct(c.successRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.unpricedRows ? (
              <p style={{ fontSize: '0.78rem', color: colors.warning, marginTop: '0.75rem' }}>
                {data.unpricedRows} row(s) excluded from USD totals: no USD rate for their currency.
              </p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
