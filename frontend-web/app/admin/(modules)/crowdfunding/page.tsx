'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPlatformStats } from '@/services/crowdfundingAdminService';
import type { CfPlatformStats } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

function naira(kobo: number): string {
  const n = kobo / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString('en-NG')}`;
}

export default function CrowdfundingOverviewPage() {
  const [stats, setStats] = useState<CfPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setStats(await getPlatformStats()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Crowdfunding Overview"
        subtitle="Platform-wide campaign, funding and risk summary."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading || !stats ? (
        <p style={{ color: colors.muted }}>Loading dashboard…</p>
      ) : (
        <>
          {/* KPI grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Total campaigns" value={stats.totalCampaigns.toLocaleString('en-NG')} />
            <Kpi label="Active" value={stats.activeCampaigns.toLocaleString('en-NG')} accent={colors.success} />
            <Kpi label="Pending review" value={String(stats.pendingReview)} accent={colors.warning} href="/admin/crowdfunding/review" />
            <Kpi label="Rejected" value={String(stats.rejectedCampaigns)} accent={colors.muted} />
            <Kpi label="Total raised (GMV)" value={naira(stats.totalRaisedKobo)} />
            <Kpi label="Platform revenue" value={naira(stats.platformRevenueKobo)} accent={colors.info} />
            <Kpi label="Funds in escrow" value={naira(stats.escrowKobo)} />
            <Kpi label="Withdrawals pending" value={`${stats.withdrawalsPending} · ${naira(stats.withdrawalsPendingKobo)}`} accent={colors.warning} href="/admin/crowdfunding/withdrawals" />
            <Kpi label="Refund requests" value={String(stats.refundRequests)} />
            <Kpi label="Fraud alerts" value={String(stats.fraudAlerts)} accent={colors.danger} href="/admin/crowdfunding/fraud" />
            <Kpi label="Open tickets" value={String(stats.openTickets)} />
            <Kpi label="Payment success" value={`${stats.paymentSuccessRate}%`} accent={colors.success} />
          </div>

          {/* Category breakdown */}
          <Card title="Category breakdown" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Category</th>
                  <th style={th()}>Campaigns</th>
                  <th style={th()}>Raised</th>
                  <th style={{ ...th(), width: '40%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {stats.categoryBreakdown.map((c) => {
                  const max = Math.max(...stats.categoryBreakdown.map((x) => x.raisedKobo), 1);
                  return (
                    <tr key={c.category} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={td()}><strong>{c.category}</strong></td>
                      <td style={td()}>{c.count.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(c.raisedKobo)}</td>
                      <td style={td()}>
                        <div style={{ background: colors.headBg, borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${(c.raisedKobo / max) * 100}%`, height: '100%', background: colors.info, borderRadius: 9999 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <Link href="/admin/crowdfunding/review" style={actionLink(colors.info)}>Review queue ({stats.pendingReview})</Link>
            <Link href="/admin/crowdfunding/withdrawals" style={actionLink(colors.warning)}>Withdrawals ({stats.withdrawalsPending})</Link>
            <Link href="/admin/crowdfunding/fraud" style={actionLink(colors.danger)}>Fraud alerts ({stats.fraudAlerts})</Link>
          </div>
        </>
      )}
    </Page>
  );
}

function Kpi({ label, value, accent, href }: { label: string; value: string; accent?: string; href?: string }) {
  const inner = (
    <Card style={{ padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.75rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
      {href && <div style={{ fontSize: '0.72rem', color: accent ?? colors.info, marginTop: 2 }}>View →</div>}
    </Card>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

const th = (): React.CSSProperties => ({ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 600, color: colors.muted, borderBottom: `1px solid ${colors.border}` });
const td = (): React.CSSProperties => ({ padding: '0.5rem 0.5rem', color: colors.text });
const actionLink = (bg: string): React.CSSProperties => ({ padding: '0.55rem 1rem', borderRadius: '0.5rem', background: bg, color: '#fff', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 });
