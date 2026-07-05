'use client';

// 9.A.2 — Fractional RE executive dashboard. KPIs + alerts.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboard } from '@/services/fractionalreAdminService';
import type { FractionalReDashboard } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, btn, th, td, money, timeAgo } from './_ui';

const SEV_ACCENT: Record<string, string> = { low: '#1d4ed8', medium: '#d97706', high: '#dc2626', critical: '#b91c1c' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Fractional Real Estate" subtitle="AUM, raises, investors, distributions and platform-wide alerts." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="dashboard" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading || !data ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="AUM" value={money(data.kpis.aumKobo)} accent="#1d4ed8" />
            <Kpi label="Total raised" value={money(data.kpis.totalRaisedKobo)} accent="#16a34a" />
            <Kpi label="Active investors" value={data.kpis.activeInvestors.toLocaleString('en-NG')} accent="#1d4ed8" />
            <Kpi label="Live rounds" value={String(data.kpis.liveRounds)} accent="#d97706" />
            <Kpi label="Payouts due" value={money(data.kpis.payoutsDueKobo)} accent={data.kpis.payoutsDueKobo ? '#d97706' : '#16a34a'} />
            <Kpi label="Pipeline value" value={money(data.kpis.pipelineValueKobo)} accent="#6b21a8" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <Card title="Compliance"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>KYC queue + limit breaches.</p><Link href="/admin/fractionalre/compliance" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Open compliance →</Link></Card>
            <Card title="Distributions"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{money(data.kpis.payoutsDueKobo)} due for release.</p><Link href="/admin/fractionalre/distributions" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Payout engine →</Link></Card>
            <Card title="Pipeline"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Assets in draft / under review.</p><Link href="/admin/fractionalre/assets" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Asset list →</Link></Card>
          </div>

          <Card title="Alerts">
            {data.alerts.length === 0 ? <p style={{ color: '#6b7280' }}>No active alerts.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Severity</th><th style={th()}>Type</th><th style={th()}>Message</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.alerts.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}><Badge status={a.severity} /></td>
                      <td style={{ ...td(), color: SEV_ACCENT[a.severity] }}>{a.kind.replace(/_/g, ' ')}</td>
                      <td style={td()}>{a.message}</td>
                      <td style={td()}>{timeAgo(a.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
