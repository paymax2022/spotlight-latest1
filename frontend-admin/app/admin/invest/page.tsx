'use client';

import { useEffect, useState } from 'react';
import { getOverview } from '@/services/investAdminService';
import type { InvestOverview } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Kpi, btn } from './_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Paymax Invest"
        subtitle="Stock-trading control plane — assets, orders, settlement, fees and audit."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading || !data ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
          <Kpi label="Tradable assets" value={`${data.assets_tradable}/${data.assets_total}`} accent="#340075" sub="Enabled / total" />
          <Kpi label="Active investors" value={data.investors.toLocaleString('en-NG')} />
          <Kpi label="Orders (all-time)" value={data.orders_total.toLocaleString('en-NG')} />
          <Kpi label="Pending settlement" value={String(data.orders_pending_settlement)} accent={data.orders_pending_settlement ? '#d97706' : '#16a34a'} sub="Awaiting T+N" />
          <Kpi label="Failed orders" value={String(data.orders_failed)} accent={data.orders_failed ? '#dc2626' : '#16a34a'} sub="Needs review" />
          <Kpi label="Open offers" value={String(data.open_offers)} />
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        Requires the <code>invest.manage</code> RBAC permission. Every change here is written to the
        invest admin audit log.
      </p>
    </div>
  );
}
