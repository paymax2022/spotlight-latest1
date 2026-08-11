'use client';

import { useEffect, useState } from 'react';
import { getP2PMarketDashboard, formatNaira, type P2PMarketDashboard } from '@/services/p2pmarketAdminService';
import { P2PMarketTabs, Kpi, DisclosureNote, StateBlock, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(kind: string): string {
  switch (kind) {
    case 'order':
      return colors.info;
    case 'dispute':
      return colors.danger;
    case 'listing':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

export default function P2PMarketDashboardPage() {
  const [data, setData] = useState<P2PMarketDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getP2PMarketDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="P2P Marketplace overview"
        subtitle="Escrow-backed peer marketplace — listings, orders in escrow, GMV and dispute arbitration."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <P2PMarketTabs active="overview" />

      <DisclosureNote>
        Thin admin surface — the only backend admin route is dispute <strong>arbitration</strong>
        (<code>/api/p2p/admin/p2p/orders/:id/arbitrate</code>, RBAC <code>p2p.dispute.arbitrate</code>). Listings and
        orders are read from member projections. Escrow holds funds and never lends (NL-6); arbitration enforces
        separation of duties and is audited (NL-12).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Listings" value={data.listings_total.toLocaleString('en-NG')} sub={`${data.listings_open} open`} accent={colors.primary} />
              <Kpi label="Orders" value={data.orders_total.toLocaleString('en-NG')} sub={`${data.orders_in_escrow} in escrow`} />
              <Kpi label="Completed (30d)" value={data.orders_completed_30d.toLocaleString('en-NG')} />
              <Kpi label="GMV (30d)" value={formatNaira(data.gmv_30d_kobo)} />
              <Kpi label="Escrow held" value={formatNaira(data.escrow_held_kobo)} sub="Funds held, never lent (NL-6)" />
              <Kpi label="Disputes open" value={data.disputes_open.toLocaleString('en-NG')} accent={data.disputes_open > 0 ? colors.danger : undefined} />
              <Kpi label="Avg seller rating" value={`${data.avg_seller_rating.toFixed(1)} / 5`} />
            </div>

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
