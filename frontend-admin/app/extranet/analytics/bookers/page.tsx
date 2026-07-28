'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBookerInsights } from '@/services/staysExtranetService';
import type { BookerInsights } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, btn, th, td, pct } from '../../_ui';

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

export default function BookersPage() {
  const [data, setData] = useState<BookerInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getBookerInsights()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxLead = data ? Math.max(...data.lead_time_buckets.map((b) => b.bookings), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Booker insights" subtitle="Who books your property — geographies, devices and how far in advance they book." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="analytics" />
      <SubTabs active="bookers" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <Card title="By geography">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Region</th><th style={th()}>Bookings</th><th style={th()}>Share</th></tr></thead>
                <tbody>{data.by_geo.map((g) => <tr key={g.region}><td style={td()}>{g.region}</td><td style={td()}>{g.bookings.toLocaleString('en-NG')}</td><td style={td()}>{pct(g.share_pct)}</td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="By device">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Device</th><th style={th()}>Bookings</th><th style={th()}>Share</th></tr></thead>
                <tbody>{data.by_device.map((d) => <tr key={d.device}><td style={td()}>{d.device}</td><td style={td()}>{d.bookings.toLocaleString('en-NG')}</td><td style={td()}>{pct(d.share_pct)}</td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="Booking lead time">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.lead_time_buckets.map((b) => (
                  <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: '0.8rem' }}>{b.bucket}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ height: 14, width: `${(b.bookings / maxLead) * 100}%`, minWidth: 3, background: '#1d4ed8', borderRadius: 3 }} />
                      <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{b.bookings}</span>
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
