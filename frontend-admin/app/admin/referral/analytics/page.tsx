'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAnalytics, formatNaira } from '@/services/referralAdminOpsService';
import type { AnalyticsOverview } from '@/types/referralAdminOps';
import { Kpi, NOT_REPORTED, errorMessage, money, numOrDash, pctOrDash } from '../_ui';
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
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // analytics registers six leaf routes and none of them answers a time series
  // (backend/internal/referral/analytics/service.go:142-148), so an absent trend
  // means "no series exists", not "growth is flat". Drawing zero bars would be
  // the second reading; drawing none and saying why is the honest one.
  const trend = data?.trend ?? [];
  const maxCac = trend.length ? Math.max(...trend.flatMap((t) => [t.referral_cac_kobo, t.paid_cac_kobo]), 1) : 1;
  const kDenominators = data?.referrers != null || data?.referred_signups != null
    ? `${numOrDash(data.referrers)} referrers · ${numOrDash(data.referred_signups)} referred signups`
    : undefined;

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
            <Kpi label="K-factor (true)" value={numOrDash(data.k_factor, 2)} accent={colors.primary}
              sub={data.k_factor_incl_house != null
                ? `Incl. house ${data.k_factor_incl_house.toFixed(2)} — not used for growth`
                : kDenominators} />
            <Kpi label="Share rate" value={pctOrDash(data.share_rate)} />
            <Kpi label="Invite accept" value={pctOrDash(data.invite_accept_rate)} />
            <Kpi label="Referral CAC" value={money(data.referral_cac_kobo)}
              accent={data.referral_cac_kobo != null && data.paid_cac_kobo != null
                ? (data.referral_cac_kobo < data.paid_cac_kobo ? colors.success : colors.warning)
                : undefined} />
            <Kpi label="Paid CAC" value={money(data.paid_cac_kobo)} />
            <Kpi label="Blended CAC" value={money(data.blended_cac_kobo)} />
          </div>

          {trend.length === 0 ? (
            <Card title="Referral CAC vs paid CAC — trend">
              <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                Not reported: no analytics route returns a dated series. {NOT_REPORTED} on the KPI strip above means the
                endpoint does not compute that metric — GET /analytics/k-factor and /analytics/cac answer current values only.
              </p>
            </Card>
          ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Referral CAC vs paid CAC — last 14 days (A-BI-03)</h2>
              <span style={{ fontSize: '0.72rem', color: colors.muted }}>Green = referral, grey = paid</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 140, overflowX: 'auto', padding: 14 }}>
              {trend.map((t) => (
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
          )}
        </>
      )}
    </Page>
  );
}
