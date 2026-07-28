'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPerformance, formatNaira } from '@/services/staysExtranetService';
import type { PerformanceAnalytics } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, StateBlock, btn, pct } from '../../_ui';

function SubTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/extranet/analytics/performance', label: 'Performance', key: 'performance' },
    { href: '/extranet/analytics/conversion', label: 'Conversion', key: 'conversion' },
    { href: '/extranet/analytics/bookers', label: 'Booker insights', key: 'bookers' },
    { href: '/extranet/analytics/market', label: 'Market context', key: 'market' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
      {tabs.map((t) => <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.3rem 0.65rem', borderRadius: '0.375rem', fontSize: '0.82rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#1d4ed8' : '#eef2ff' }}>{t.label}</Link>)}
    </div>
  );
}

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPerformance()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxRev = data ? Math.max(...data.trend.map((t) => t.revpar_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Performance" subtitle="Occupancy, average daily rate (ADR) and revenue per available room (RevPAR) — last 30 days." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="analytics" />
      <SubTabs active="performance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Occupancy" value={pct(data.occupancy_pct)} accent="#340075" />
              <Kpi label="ADR" value={formatNaira(data.adr_kobo)} sub="Average daily rate" />
              <Kpi label="RevPAR" value={formatNaira(data.revpar_kobo)} sub="Per available room" accent="#15803d" />
              <Kpi label="Revenue (30d)" value={formatNaira(data.total_revenue_30d_kobo)} sub={data.currency} />
            </div>

            <Card title="RevPAR trend (14d)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {data.trend.map((t) => (
                  <div key={t.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{t.date.slice(5)}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ height: 10, width: `${(t.revpar_kobo / maxRev) * 100}%`, minWidth: 2, background: '#15803d', borderRadius: 2 }} />
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(t.revpar_kobo)} · {pct(t.occupancy_pct)} occ</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
