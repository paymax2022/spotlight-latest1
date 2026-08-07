'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAnalytics, formatNaira } from '@/services/referralAdminOpsService';
import type { AnalyticsOverview } from '@/types/referralAdminOps';
import { Kpi } from '../_ui';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Analytics — Growth & K-factor"
        subtitle="Viral coefficient, share rate & CAC efficiency (A-BI-01/03). True K-factor EXCLUDES house-captured organic signups (§7A.6)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href}><Button variant="outline" sm>{l.label}</Button></Link>)}
      </div>

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>No records found.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="K-factor (true)" value={data.k_factor.toFixed(2)} sub={`Incl. house ${data.k_factor_incl_house.toFixed(2)} — not used for growth`} accent={colors.primary} />
            <Kpi label="Share rate" value={`${(data.share_rate * 100).toFixed(1)}%`} />
            <Kpi label="Invite accept" value={`${(data.invite_accept_rate * 100).toFixed(1)}%`} />
            <Kpi label="Referral CAC" value={formatNaira(data.referral_cac_kobo)} accent={data.referral_cac_kobo < data.paid_cac_kobo ? colors.success : colors.warning} />
            <Kpi label="Paid CAC" value={formatNaira(data.paid_cac_kobo)} />
            <Kpi label="Blended CAC" value={formatNaira(data.blended_cac_kobo)} />
          </div>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Referral CAC vs paid CAC — last 14 days (A-BI-03)</h2>
              <span style={{ fontSize: '0.72rem', color: colors.muted }}>Green = referral, grey = paid</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 140, overflowX: 'auto', padding: 14 }}>
              {data.trend.map((t) => (
                <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 32 }}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                    <div style={{ width: 9, height: (t.referral_cac_kobo / maxCac) * 110 + 4, background: colors.success, borderRadius: 2 }} title={`Referral ${formatNaira(t.referral_cac_kobo)}`} />
                    <div style={{ width: 9, height: (t.paid_cac_kobo / maxCac) * 110 + 4, background: colors.secondary, borderRadius: 2 }} title={`Paid ${formatNaira(t.paid_cac_kobo)}`} />
                  </div>
                  <span style={{ fontSize: '0.6rem', color: colors.muted, marginTop: 2 }}>{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
