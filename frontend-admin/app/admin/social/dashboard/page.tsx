'use client';

import { useEffect, useState } from 'react';
import { getSocialDashboard, formatNaira } from '@/services/socialAdminService';
import type { SocialDashboard } from '@/types/socialAdmin';
import { PageHeader, SocialTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../../savings/_ui';

export default function SocialDashboardPage() {
  const [data, setData] = useState<SocialDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSocialDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxVol = data ? Math.max(...data.volume_trend.map((p) => p.p2p_kobo + p.split_kobo + p.pool_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Social Pay overview" subtitle="P2P volume, split-bill and group-pool activity, plus reversal / dispute / AML watch across the social-payments rail." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SocialTabs active="overview" />
      <DisclosureNote>NL-10 — every P2P send is checked against KYC-tier velocity / AML limits, fail-closed. NL-8 — money is a ledger; reversals are reversing entries only, never balance edits. NL-12 — every reversal, limit change and dispute decision is recorded to the immutable audit log.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="P2P volume today" value={formatNaira(data.p2p_volume_today_kobo)} sub={`${data.p2p_count_today.toLocaleString('en-NG')} sends`} accent="#340075" />
              <Kpi label="P2P volume (30d)" value={formatNaira(data.p2p_volume_30d_kobo)} sub={`${data.p2p_count_30d.toLocaleString('en-NG')} sends`} />
              <Kpi label="Avg P2P value" value={formatNaira(data.avg_p2p_value_kobo)} />
              <Kpi label="Splits active" value={data.splits_active.toLocaleString('en-NG')} sub={`${formatNaira(data.split_outstanding_kobo)} outstanding`} />
              <Kpi label="Pools active" value={data.pools_active.toLocaleString('en-NG')} sub={`${formatNaira(data.pool_held_kobo)} held`} />
              <Kpi label="Reversals pending" value={data.reversals_pending.toLocaleString('en-NG')} sub={formatNaira(data.reversals_value_kobo)} accent={data.reversals_pending > 0 ? '#9a3412' : undefined} />
              <Kpi label="Disputes open" value={data.disputes_open.toLocaleString('en-NG')} accent={data.disputes_open > 0 ? '#9a3412' : undefined} />
              <Kpi label="Limit breaches (24h)" value={data.limit_breaches_24h.toLocaleString('en-NG')} sub="Blocked, fail-closed" />
              <Kpi label="AML flags open" value={data.aml_flags_open.toLocaleString('en-NG')} accent={data.aml_flags_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Cashtags flagged" value={data.cashtags_flagged.toLocaleString('en-NG')} accent={data.cashtags_flagged > 0 ? '#b91c1c' : undefined} />
            </div>

            <Card title="Activity volume (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>P2P (purple) · split (blue) · pool (green)</span>}>
              {data.volume_trend.length === 0 ? <p style={{ color: '#6b7280' }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {data.volume_trend.map((p) => (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: 12, borderRadius: 2, overflow: 'hidden', background: '#f3f4f6' }}>
                        <div style={{ height: '100%', width: `${(p.p2p_kobo / maxVol) * 100}%`, background: '#340075' }} title={`P2P ${formatNaira(p.p2p_kobo)}`} />
                        <div style={{ height: '100%', width: `${(p.split_kobo / maxVol) * 100}%`, background: '#1d4ed8' }} title={`Split ${formatNaira(p.split_kobo)}`} />
                        <div style={{ height: '100%', width: `${(p.pool_kobo / maxVol) * 100}%`, background: '#15803d' }} title={`Pool ${formatNaira(p.pool_kobo)}`} />
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap', width: 130, textAlign: 'right' }}>{formatNaira(p.p2p_kobo + p.split_kobo + p.pool_kobo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}>{a.label}</td>
                        <td style={td()}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={td()}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
