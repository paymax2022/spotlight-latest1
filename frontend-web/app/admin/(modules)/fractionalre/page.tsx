'use client';

// 9.A.2 — Fractional RE executive dashboard. KPIs + alerts.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboard } from '@/services/fractionalreAdminService';
import type { FractionalReDashboard } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, money, timeAgo } from './_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SEV_ACCENT: Record<string, string> = { low: colors.info, medium: colors.warning, high: colors.danger, critical: colors.danger };
const SEV_BADGE: Record<string, string> = { low: colors.info, medium: colors.warning, high: colors.danger, critical: colors.danger };

export default function FractionalReDashboardPage() {
  const [data, setData] = useState<FractionalReDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getDashboard()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader title="Fractional Real Estate" subtitle="AUM, raises, investors, distributions and platform-wide alerts." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="dashboard" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading || !data ? (
        <p style={{ color: colors.muted }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="AUM" value={money(data.kpis.aumKobo)} accent={colors.info} />
            <Kpi label="Total raised" value={money(data.kpis.totalRaisedKobo)} accent={colors.success} />
            <Kpi label="Active investors" value={data.kpis.activeInvestors.toLocaleString('en-NG')} accent={colors.info} />
            <Kpi label="Live rounds" value={String(data.kpis.liveRounds)} accent={colors.warning} />
            <Kpi label="Payouts due" value={money(data.kpis.payoutsDueKobo)} accent={data.kpis.payoutsDueKobo ? colors.warning : colors.success} />
            <Kpi label="Pipeline value" value={money(data.kpis.pipelineValueKobo)} accent={colors.secondary} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <Card title="Compliance"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>KYC queue + limit breaches.</p><Link href="/admin/fractionalre/compliance" style={{ fontSize: '0.85rem', color: colors.info }}>Open compliance →</Link></Card>
            <Card title="Distributions"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>{money(data.kpis.payoutsDueKobo)} due for release.</p><Link href="/admin/fractionalre/distributions" style={{ fontSize: '0.85rem', color: colors.info }}>Payout engine →</Link></Card>
            <Card title="Pipeline"><p style={{ color: colors.muted, fontSize: '0.85rem' }}>Assets in draft / under review.</p><Link href="/admin/fractionalre/assets" style={{ fontSize: '0.85rem', color: colors.info }}>Asset list →</Link></Card>
          </div>

          <Card title="Alerts">
            {data.alerts.length === 0 ? <p style={{ color: colors.muted }}>No active alerts.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Severity</th><th style={thCell}>Type</th><th style={thCell}>Message</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {data.alerts.map((a) => (
                    <tr key={a.id}>
                      <td style={tdCell}><Badge text={a.severity} color={SEV_BADGE[a.severity] ?? colors.secondary} /></td>
                      <td style={{ ...tdCell, color: SEV_ACCENT[a.severity] }}>{a.kind.replace(/_/g, ' ')}</td>
                      <td style={tdCell}>{a.message}</td>
                      <td style={tdCell}>{timeAgo(a.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
