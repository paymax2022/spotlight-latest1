'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPlatformStats } from '@/services/crowdfundingAdminService';
import type { CfPlatformStats } from '@/types/crowdfunding';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Crowdfunding Overview</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>Platform-wide campaign, funding and risk summary.</p>
        </div>
        <button onClick={load} style={btn()}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading || !stats ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <>
          {/* KPI grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Total campaigns" value={stats.totalCampaigns.toLocaleString('en-NG')} />
            <Kpi label="Active" value={stats.activeCampaigns.toLocaleString('en-NG')} accent="#16a34a" />
            <Kpi label="Pending review" value={String(stats.pendingReview)} accent="#d97706" href="/admin/crowdfunding/review" />
            <Kpi label="Rejected" value={String(stats.rejectedCampaigns)} accent="#6b7280" />
            <Kpi label="Total raised (GMV)" value={naira(stats.totalRaisedKobo)} />
            <Kpi label="Platform revenue" value={naira(stats.platformRevenueKobo)} accent="#1d4ed8" />
            <Kpi label="Funds in escrow" value={naira(stats.escrowKobo)} />
            <Kpi label="Withdrawals pending" value={`${stats.withdrawalsPending} · ${naira(stats.withdrawalsPendingKobo)}`} accent="#d97706" href="/admin/crowdfunding/withdrawals" />
            <Kpi label="Refund requests" value={String(stats.refundRequests)} />
            <Kpi label="Fraud alerts" value={String(stats.fraudAlerts)} accent="#dc2626" href="/admin/crowdfunding/fraud" />
            <Kpi label="Open tickets" value={String(stats.openTickets)} />
            <Kpi label="Payment success" value={`${stats.paymentSuccessRate}%`} accent="#16a34a" />
          </div>

          {/* Category breakdown */}
          <div style={card()}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Category breakdown</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
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
                    <tr key={c.category} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong>{c.category}</strong></td>
                      <td style={td()}>{c.count.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(c.raisedKobo)}</td>
                      <td style={td()}>
                        <div style={{ background: '#f3f4f6', borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${(c.raisedKobo / max) * 100}%`, height: '100%', background: '#1d4ed8', borderRadius: 9999 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <Link href="/admin/crowdfunding/review" style={actionLink('#1d4ed8')}>Review queue ({stats.pendingReview})</Link>
            <Link href="/admin/crowdfunding/withdrawals" style={actionLink('#d97706')}>Withdrawals ({stats.withdrawalsPending})</Link>
            <Link href="/admin/crowdfunding/fraud" style={actionLink('#dc2626')}>Fraud alerts ({stats.fraudAlerts})</Link>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent, href }: { label: string; value: string; accent?: string; href?: string }) {
  const inner = (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4, color: '#111827' }}>{value}</div>
      {href && <div style={{ fontSize: '0.72rem', color: accent ?? '#1d4ed8', marginTop: 2 }}>View →</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
const th = (): React.CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600 });
const td = (): React.CSSProperties => ({ padding: '0.5rem 0.5rem', color: '#374151' });
const actionLink = (bg: string): React.CSSProperties => ({ padding: '0.55rem 1rem', borderRadius: '0.5rem', background: bg, color: '#fff', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 });
