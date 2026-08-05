'use client';

import { useEffect, useState } from 'react';
import { getEscrowDashboard, formatNaira } from '@/services/escrowAdminService';
import type { EscrowDashboard } from '@/types/escrowAdmin';
import { PageHeader, EscrowTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../../creators/_ui';
import { colors } from '@/components/ui/vuexy';

export default function EscrowDashboardPage() {
  const [data, setData] = useState<EscrowDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getEscrowDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxRes = data ? Math.max(...data.resolution_trend.map((p) => Math.max(p.opened, p.resolved)), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="P2P escrow oversight"
        subtitle="Holds, releases, refunds and open disputes across the P2P marketplace escrow rail. Reconciles the ledger held-balance projection against the custodial account."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <EscrowTabs active="overview" />

      <DisclosureNote>
        <strong>NL-6 — escrow holds, never lends.</strong> Funds sit in the buyer&apos;s held sub-balance and release on confirmation or arbitration.
        Paymax never takes principal risk and never funds the gap. Held balances are a ledger projection (NL-8) reconciled against custody. Every state change posts an immutable audit event (NL-12). Amounts shown ₦ (stored as kobo).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total held" value={formatNaira(data.total_held_kobo)} sub={`${data.held_count.toLocaleString('en-NG')} active holds`} accent="#340075" />
              <Kpi label="Released (30d)" value={formatNaira(data.released_30d_kobo)} sub={`${data.released_30d_count.toLocaleString('en-NG')} releases`} accent="#15803d" />
              <Kpi label="Refunded (30d)" value={formatNaira(data.refunded_30d_kobo)} sub={`${data.refunded_30d_count.toLocaleString('en-NG')} refunds`} accent="#7c3aed" />
              <Kpi label="Disputed (open)" value={formatNaira(data.disputed_open_kobo)} sub={`${data.disputed_open_count.toLocaleString('en-NG')} disputes`} accent={data.disputed_open_count > 0 ? '#9a3412' : undefined} />
              <Kpi label="Ledger held" value={formatNaira(data.ledger_held_kobo)} sub="Projection (NL-8)" />
              <Kpi label="Custody balance" value={formatNaira(data.custody_balance_kobo)} />
              <Kpi label="Recon delta" value={formatNaira(data.delta_kobo)} sub="Should be ₦0.00" accent={data.delta_kobo !== 0 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Avg resolution" value={`${data.avg_resolution_hours.toFixed(1)}h`} />
              <Kpi label="Release rate" value={pct(data.dispute_release_rate)} sub="Resolved in seller's favour" />
              <Kpi label="Fraud open" value={data.fraud_open.toLocaleString('en-NG')} accent={data.fraud_open > 0 ? '#b91c1c' : undefined} />
            </div>

            <Card title="Escrow state mix">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>State</th><th style={th()}>Count</th><th style={th()}>Value</th></tr></thead>
                <tbody>
                  {data.state_mix.map((s) => (
                    <tr key={s.state}>
                      <td style={td()}><Badge status={s.state} /></td>
                      <td style={td()}>{s.count.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(s.value_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Disputes opened vs resolved (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>opened (orange) · resolved (green)</span>}>
              {data.resolution_trend.length === 0 ? <p style={{ color: '#6b7280' }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.resolution_trend.map((p) => (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 64, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${(p.opened / maxRes) * 100}%`, minWidth: 2, background: '#9a3412', borderRadius: 2 }} title={`Opened ${p.opened}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{p.opened} opened</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${(p.resolved / maxRes) * 100}%`, minWidth: 2, background: '#15803d', borderRadius: 2 }} title={`Resolved ${p.resolved}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{p.resolved} resolved</span>
                        </div>
                      </div>
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
