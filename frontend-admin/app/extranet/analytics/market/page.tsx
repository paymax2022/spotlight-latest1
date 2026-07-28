'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getMarketContext, formatNaira } from '@/services/staysExtranetService';
import type { MarketContext } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, StateBlock, btn, th, td, pct } from '../../_ui';

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

export default function MarketPage() {
  const [data, setData] = useState<MarketContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getMarketContext()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Competitor / market rate context" subtitle="How your rates and occupancy compare to similar properties in your area." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="analytics" />
      <SubTabs active="market" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Your ADR" value={formatNaira(data.your_adr_kobo)} sub={data.currency} accent="#340075" />
              <Kpi label="Market median ADR" value={formatNaira(data.market_median_adr_kobo)} />
              <Kpi label="Vs market" value={`${data.your_adr_kobo >= data.market_median_adr_kobo ? '+' : ''}${pct((data.your_adr_kobo - data.market_median_adr_kobo) / data.market_median_adr_kobo)}`} accent={data.your_adr_kobo >= data.market_median_adr_kobo ? '#9a3412' : '#15803d'} />
            </div>
            <Card title="Comparable set">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Comp set</th><th style={th()}>ADR</th><th style={th()}>Occupancy</th></tr></thead>
                <tbody>{data.comp_set.map((c) => <tr key={c.name}><td style={td()}>{c.name}</td><td style={td()}>{formatNaira(c.adr_kobo)}</td><td style={td()}>{pct(c.occupancy_pct)}</td></tr>)}</tbody>
              </table>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.75rem' }}>{data.note}</p>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
