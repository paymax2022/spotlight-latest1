'use client';

import { useEffect, useState } from 'react';
import { getBlackDashboard, formatNaira } from '@/services/blackAdminService';
import type { BlackDashboard } from '@/types/blackAdmin';
import { BlackTabs, Kpi, DisclosureNote, StateBlock, timeAgo } from '../../creators/_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(kind: string): string {
  switch (kind) {
    case 'redemption':
      return colors.success;
    case 'partner':
      return colors.info;
    case 'settlement':
      return colors.primary;
    default:
      return colors.secondary;
  }
}

export default function BlackDashboardPage() {
  const [data, setData] = useState<BlackDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getBlackDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxRedeem = data ? Math.max(...data.redemption_mix.map((m) => m.count), 1) : 1;

  return (
    <Page>
      <PageHeader
        title="Paymax Black overview"
        subtitle="Premium membership: members, perk redemptions, perk cost/liability, partner offers and partner settlement due."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <BlackTabs active="overview" />

      <DisclosureNote>
        Black perks are <strong>closed-loop</strong> — redeemed inside the ecosystem (early tickets, lounge, discounts) via a single-use credential, never as a cash instrument (NL-3).
        Points/perks are never redeemable to cash (NL-4). Every perk, partner and settlement change posts an immutable audit event (NL-12). Amounts shown ₦ (stored as kobo).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Black members" value={data.members_total.toLocaleString('en-NG')} sub={`${data.members_active.toLocaleString('en-NG')} active`} accent={colors.primary} />
              <Kpi label="New (30d)" value={data.members_new_30d.toLocaleString('en-NG')} accent={colors.success} />
              <Kpi label="Churn (30d)" value={data.churn_30d.toLocaleString('en-NG')} accent={data.churn_30d > 0 ? colors.warning : undefined} />
              <Kpi label="Membership revenue (30d)" value={formatNaira(data.membership_revenue_30d_kobo)} />
              <Kpi label="Perk redemptions (30d)" value={data.perk_redemptions_30d.toLocaleString('en-NG')} />
              <Kpi label="Perk cost (30d)" value={formatNaira(data.perk_cost_30d_kobo)} sub="Platform-borne liability" accent={data.perk_cost_30d_kobo > 0 ? colors.warning : undefined} />
              <Kpi label="Active partner offers" value={data.partner_offers_active.toLocaleString('en-NG')} />
              <Kpi label="Partners active" value={data.partners_active.toLocaleString('en-NG')} />
              <Kpi label="Settlement due" value={formatNaira(data.partner_settlement_due_kobo)} sub="Owed to partners" accent={data.partner_settlement_due_kobo > 0 ? colors.warning : undefined} />
              <Kpi label="Settlement breaks" value={data.settlement_breaks_open.toLocaleString('en-NG')} accent={data.settlement_breaks_open > 0 ? colors.danger : undefined} />
            </div>

            <Card title="Redemption mix (30d)" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.redemption_mix.map((m) => (
                  <div key={m.kind} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 140, flexShrink: 0 }}><Badge text={m.kind.replace(/_/g, ' ')} color={statusColor(m.kind)} /></span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ height: 12, width: `${(m.count / maxRedeem) * 100}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} />
                      <span style={{ fontSize: '0.72rem', color: colors.muted, whiteSpace: 'nowrap' }}>{m.count.toLocaleString('en-NG')} · cost {formatNaira(m.cost_kobo)}</span>
                    </div>
                  </div>
                ))}
              </div>
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
