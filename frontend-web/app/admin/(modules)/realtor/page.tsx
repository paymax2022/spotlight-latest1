'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getOverview } from '@/services/realtorAdminService';
import type { RealtorOverview } from '@/types/realtorAdmin';
import { PageHeader, RealtorTabs, Card, Kpi, btn, money } from './_ui';

export default function RealtorOverviewPage() {
  const [data, setData] = useState<RealtorOverview | null>(null);
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
      <PageHeader title="Realtor Operations" subtitle="Listings, verification, tenancy, payments, escrow and risk across the marketplace." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <RealtorTabs active="overview" />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading || !data ? (
        <p style={{ color: '#6b7280' }}>Loading dashboard…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Live listings" value={data.listingsLive.toLocaleString('en-NG')} />
            <Kpi label="Pending moderation" value={String(data.pendingModeration)} accent={data.pendingModeration ? '#d97706' : '#16a34a'} sub="Awaiting review" />
            <Kpi label="Pending verification" value={String(data.pendingVerification)} accent={data.pendingVerification ? '#d97706' : '#16a34a'} />
            <Kpi label="Active leases" value={data.activeLeases.toLocaleString('en-NG')} accent="#1d4ed8" />
            <Kpi label="Escrow held" value={money(data.escrowHeldKobo)} accent="#1d4ed8" />
            <Kpi label="Payouts due" value={money(data.payoutsDueKobo)} accent="#16a34a" />
            <Kpi label="GMV (30d)" value={money(data.gmvKobo)} accent="#16a34a" />
            <Kpi label="Open disputes" value={String(data.openDisputes)} accent={data.openDisputes ? '#dc2626' : '#16a34a'} />
            <Kpi label="Fraud flags" value={String(data.fraudFlags)} accent={data.fraudFlags ? '#dc2626' : '#16a34a'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <Card title="Moderation"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{data.pendingModeration} listing(s) waiting.</p><Link href="/admin/realtor/moderation" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Open queue →</Link></Card>
            <Card title="Verification"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{data.pendingVerification} request(s) waiting.</p><Link href="/admin/realtor/verification" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>Review →</Link></Card>
            <Card title="Payments & escrow"><p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{money(data.escrowHeldKobo)} held in escrow.</p><Link href="/admin/realtor/payments" style={{ fontSize: '0.85rem', color: '#1d4ed8' }}>View ledger →</Link></Card>
          </div>
        </>
      )}
    </div>
  );
}
