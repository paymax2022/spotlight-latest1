'use client';

import { useEffect, useState } from 'react';
import { getOverview } from '@/services/investAdminService';
import type { InvestOverview } from '@/types/investAdmin';
import { InvestTabs, Kpi } from './_ui';
import { Page, PageHeader, Button, colors } from '@/components/ui/vuexy';

export default function InvestOverviewPage() {
  const [data, setData] = useState<InvestOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getOverview()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Paymax Invest"
        subtitle="Stock-trading control plane — assets, orders, settlement, fees and audit."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {loading || !data ? (
        <p style={{ color: colors.muted }}>Loading dashboard…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
          <Kpi label="Tradable assets" value={`${data.assets_tradable}/${data.assets_total}`} accent={colors.primary} sub="Enabled / total" />
          <Kpi label="Active investors" value={data.investors.toLocaleString('en-NG')} />
          <Kpi label="Orders (all-time)" value={data.orders_total.toLocaleString('en-NG')} />
          <Kpi label="Pending settlement" value={String(data.orders_pending_settlement)} accent={data.orders_pending_settlement ? colors.warning : colors.success} sub="Awaiting T+N" />
          <Kpi label="Failed orders" value={String(data.orders_failed)} accent={data.orders_failed ? colors.danger : colors.success} sub="Needs review" />
          <Kpi label="Open offers" value={String(data.open_offers)} />
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Requires the <code>invest.manage</code> RBAC permission. Every change here is written to the
        invest admin audit log.
      </p>
    </Page>
  );
}
