'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConversion } from '@/services/staysExtranetService';
import type { ConversionFunnel } from '@/types/staysExtranet';
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

export default function ConversionPage() {
  const [data, setData] = useState<ConversionFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConversion()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const steps = data ? [
    { label: 'Searches', value: data.searches },
    { label: 'Property views', value: data.property_views },
    { label: 'Rate views', value: data.rate_views },
    { label: 'Add to cart', value: data.add_to_cart },
    { label: 'Bookings', value: data.bookings },
  ] : [];
  const max = steps.length ? steps[0].value : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Conversion & funnel" subtitle="How travellers move from search to booking on your property." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="analytics" />
      <SubTabs active="conversion" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="View → book" value={pct(data.view_to_book_pct)} accent="#340075" />
              <Kpi label="Bookings (30d)" value={data.bookings.toLocaleString('en-NG')} accent="#15803d" />
            </div>
            <Card title="Booking funnel (30d)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {steps.map((s, i) => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 120, flexShrink: 0, fontSize: '0.8rem', fontWeight: 600 }}>{s.label}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ height: 18, width: `${(s.value / max) * 100}%`, minWidth: 4, background: '#340075', borderRadius: 3, opacity: 1 - i * 0.13 }} />
                      <span style={{ fontSize: '0.78rem', color: '#374151' }}>{s.value.toLocaleString('en-NG')} <span style={{ color: '#9ca3af' }}>({pct(s.value / max)})</span></span>
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
