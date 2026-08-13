'use client';

import { useEffect, useState } from 'react';
import { getSocialDashboard, formatNaira } from '@/services/socialAdminService';
import type { SocialDashboard } from '@/types/socialAdmin';
import { SocialTabs, Kpi, DisclosureNote, StateBlock, timeAgo } from '../../savings/_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(kind: string): string {
  switch (kind) {
    case 'p2p':
      return colors.primary;
    case 'split':
      return colors.info;
    case 'pool':
      return colors.success;
    case 'reversal':
    case 'reversed':
      return colors.warning;
    default:
      return colors.secondary;
  }
}

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
    <Page>
      <PageHeader title="Social Pay overview" subtitle="P2P volume, split-bill and group-pool activity, plus reversal / dispute / AML watch across the social-payments rail." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SocialTabs active="overview" />
      <DisclosureNote>NL-10 — every P2P send is checked against KYC-tier velocity / AML limits, fail-closed. NL-8 — money is a ledger; reversals are reversing entries only, never balance edits. NL-12 — every reversal, limit change and dispute decision is recorded to the immutable audit log.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="P2P volume today" value={formatNaira(data.p2p_volume_today_kobo)} sub={`${data.p2p_count_today.toLocaleString('en-NG')} sends`} accent={colors.primary} />
              <Kpi label="P2P volume (30d)" value={formatNaira(data.p2p_volume_30d_kobo)} sub={`${data.p2p_count_30d.toLocaleString('en-NG')} sends`} />
              <Kpi label="Avg P2P value" value={formatNaira(data.avg_p2p_value_kobo)} />
              <Kpi label="Splits active" value={data.splits_active.toLocaleString('en-NG')} sub={`${formatNaira(data.split_outstanding_kobo)} outstanding`} />
              <Kpi label="Pools active" value={data.pools_active.toLocaleString('en-NG')} sub={`${formatNaira(data.pool_held_kobo)} held`} />
              <Kpi label="Reversals pending" value={data.reversals_pending.toLocaleString('en-NG')} sub={formatNaira(data.reversals_value_kobo)} accent={data.reversals_pending > 0 ? colors.warning : undefined} />
              <Kpi label="Disputes open" value={data.disputes_open.toLocaleString('en-NG')} accent={data.disputes_open > 0 ? colors.warning : undefined} />
              <Kpi label="Limit breaches (24h)" value={data.limit_breaches_24h.toLocaleString('en-NG')} sub="Blocked, fail-closed" />
              <Kpi label="AML flags open" value={data.aml_flags_open.toLocaleString('en-NG')} accent={data.aml_flags_open > 0 ? colors.danger : undefined} />
              <Kpi label="Cashtags flagged" value={data.cashtags_flagged.toLocaleString('en-NG')} accent={data.cashtags_flagged > 0 ? colors.danger : undefined} />
            </div>

            <Card style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Activity volume (14d)</h2>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>P2P (purple) · split (blue) · pool (green)</span>
              </div>
              {data.volume_trend.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {data.volume_trend.map((p) => (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: 12, borderRadius: 2, overflow: 'hidden', background: colors.border }}>
                        <div style={{ height: '100%', width: `${(p.p2p_kobo / maxVol) * 100}%`, background: colors.primary }} title={`P2P ${formatNaira(p.p2p_kobo)}`} />
                        <div style={{ height: '100%', width: `${(p.split_kobo / maxVol) * 100}%`, background: colors.info }} title={`Split ${formatNaira(p.split_kobo)}`} />
                        <div style={{ height: '100%', width: `${(p.pool_kobo / maxVol) * 100}%`, background: colors.success }} title={`Pool ${formatNaira(p.pool_kobo)}`} />
                      </div>
                      <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap', width: 130, textAlign: 'right' }}>{formatNaira(p.p2p_kobo + p.split_kobo + p.pool_kobo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: colors.muted }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}>{a.label}</td>
                        <td style={tdCell}><Badge text={a.kind.replace(/_/g, ' ')} color={statusColor(a.kind)} /></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
