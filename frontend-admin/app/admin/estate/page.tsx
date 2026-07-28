'use client';

// A-EST-01 — Estate dashboard. KPI cards + recent activity.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEstateKpis, getEstateActivity } from '@/services/estateAdminService';
import type { EstateKpis, EstateActivity } from '@/types/estateAdmin';
import { PageHeader, EstateTabs, Card, Kpi, Badge, btn, th, td, money, timeAgo } from './_ui';

export default function EstateDashboardPage() {
  const [kpis, setKpis] = useState<EstateKpis | null>(null);
  const [activity, setActivity] = useState<EstateActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [k, a] = await Promise.all([getEstateKpis(), getEstateActivity()]);
      setKpis(k); setActivity(a);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const collectedPct = kpis && kpis.expectedThisCycleKobo > 0
    ? Math.round((kpis.collectionsThisCycleKobo / kpis.expectedThisCycleKobo) * 100) : 0;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Estate operations" subtitle="Residents, collections, security and vendors across the estate." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EstateTabs active="dashboard" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading || !kpis ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Residents" value={kpis.residents.toLocaleString('en-NG')} sub={`${kpis.units} units`} accent="#1d4ed8" />
            <Kpi label="Collections this cycle" value={money(kpis.collectionsThisCycleKobo)} sub={`${collectedPct}% of ${money(kpis.expectedThisCycleKobo)}`} accent="#16a34a" />
            <Kpi label="Arrears" value={money(kpis.arrearsKobo)} accent={kpis.arrearsKobo ? '#d97706' : '#16a34a'} />
            <Kpi label="Open incidents" value={String(kpis.openIncidents)} accent={kpis.openIncidents ? '#dc2626' : '#16a34a'} />
            <Kpi label="Active vendors" value={String(kpis.activeVendors)} accent="#1d4ed8" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <Card title="Collections"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{money(kpis.collectionsThisCycleKobo)} collected this cycle.</p><Link href="/admin/estate/dues" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Open dues →</Link></Card>
            <Card title="Security"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{kpis.openIncidents} open incident(s).</p><Link href="/admin/estate/gates" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Gates & incidents →</Link></Card>
            <Card title="Vendors"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{kpis.activeVendors} active vendor(s).</p><Link href="/admin/estate/vendors" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Vendor directory →</Link></Card>
          </div>

          <Card title="Recent activity">
            {activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Type</th><th style={th()}>Summary</th><th style={th()}>Actor</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}><Badge status={a.kind} /></td>
                      <td style={td()}>{a.summary}</td>
                      <td style={td()}>{a.actor}</td>
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
