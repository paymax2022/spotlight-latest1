'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAnalytics, formatNaira } from '@/services/referralAdminOpsService';
import type { AnalyticsOverview } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, btn, StateBlock } from '../_ui';

const links = [
  { href: '/admin/referral/analytics/funnel', label: 'Acquisition funnel' },
  { href: '/admin/referral/analytics/segmentation', label: 'Organic vs referred' },
];

export default function AnalyticsOverviewPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getAnalytics()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxCac = data ? Math.max(...data.trend.flatMap((t) => [t.referral_cac_kobo, t.paid_cac_kobo]), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Analytics — Growth & K-factor"
        subtitle="Viral coefficient, share rate & CAC efficiency (A-BI-01/03). True K-factor EXCLUDES house-captured organic signups (§7A.6)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href} style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>{l.label}</Link>)}
      </div>

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="K-factor (true)" value={data.k_factor.toFixed(2)} sub={`Incl. house ${data.k_factor_incl_house.toFixed(2)} — not used for growth`} accent="#340075" />
              <Kpi label="Share rate" value={`${(data.share_rate * 100).toFixed(1)}%`} />
              <Kpi label="Invite accept" value={`${(data.invite_accept_rate * 100).toFixed(1)}%`} />
              <Kpi label="Referral CAC" value={formatNaira(data.referral_cac_kobo)} accent={data.referral_cac_kobo < data.paid_cac_kobo ? '#15803d' : '#9a3412'} />
              <Kpi label="Paid CAC" value={formatNaira(data.paid_cac_kobo)} />
              <Kpi label="Blended CAC" value={formatNaira(data.blended_cac_kobo)} />
            </div>

            <Card title="Referral CAC vs paid CAC — last 14 days (A-BI-03)" right={<span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Green = referral, grey = paid</span>}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 140, overflowX: 'auto' }}>
                {data.trend.map((t) => (
                  <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 32 }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                      <div style={{ width: 9, height: (t.referral_cac_kobo / maxCac) * 110 + 4, background: '#22c55e', borderRadius: 2 }} title={`Referral ${formatNaira(t.referral_cac_kobo)}`} />
                      <div style={{ width: 9, height: (t.paid_cac_kobo / maxCac) * 110 + 4, background: '#cbd5e1', borderRadius: 2 }} title={`Paid ${formatNaira(t.paid_cac_kobo)}`} />
                    </div>
                    <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2 }}>{t.date.slice(5)}</span>
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
