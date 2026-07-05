'use client';

import { useEffect, useState } from 'react';
import {
  listModerationQueue, listDisputesQueue, listFlags, listOrdersAging, formatKobo,
} from '@/services/marketplaceAdminService';
import { PageHeader, MarketplaceTabs, Card, Kpi, DisclosureNote } from './_ui';

export default function MarketplaceOverviewPage() {
  const [pendingListings, setPendingListings] = useState<number | null>(null);
  const [openDisputes, setOpenDisputes] = useState<number | null>(null);
  const [openFlags, setOpenFlags] = useState<number | null>(null);
  const [agingOrders, setAgingOrders] = useState<number | null>(null);
  const [agingValueKobo, setAgingValueKobo] = useState<number>(0);

  useEffect(() => {
    void listModerationQueue().then((r) => setPendingListings(r.length)).catch(() => setPendingListings(null));
    void listDisputesQueue('under_review').then((r) => setOpenDisputes(r.length)).catch(() => setOpenDisputes(null));
    void listFlags('open').then((r) => setOpenFlags(r.length)).catch(() => setOpenFlags(null));
    void listOrdersAging().then((r) => {
      setAgingOrders(r.length);
      setAgingValueKobo(r.reduce((sum, o) => sum + o.amount_kobo, 0));
    }).catch(() => setAgingOrders(null));
  }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Paymax Marketplace — Ops Console"
        subtitle="Moderation, dispute arbitration, safety flags, and order-health oversight for the Jiji-style classifieds + escrow marketplace."
      />
      <MarketplaceTabs active="" />
      <DisclosureNote>
        Every mutating action across this console requires a <code>reason_code</code> and writes an immutable
        <code> mkt_admin_audit_log</code> row. Dispute decisions on orders over ₦500,000 require a second, distinct approver
        (dual-approval — see the Disputes tab). Backend RBAC (<code>marketplace.admin.*</code>) is authoritative.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Listings pending review" value={pendingListings != null ? String(pendingListings) : '—'} accent={pendingListings && pendingListings > 0 ? '#9a3412' : undefined} />
        <Kpi label="Disputes under review" value={openDisputes != null ? String(openDisputes) : '—'} accent={openDisputes && openDisputes > 0 ? '#1d4ed8' : undefined} />
        <Kpi label="Open safety flags" value={openFlags != null ? String(openFlags) : '—'} accent={openFlags && openFlags > 0 ? '#b91c1c' : undefined} />
        <Kpi label="Aging orders" value={agingOrders != null ? String(agingOrders) : '—'} sub={agingOrders ? formatKobo(agingValueKobo) + ' at risk' : undefined} />
      </div>

      <Card title="Modules">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.88rem', color: '#374151', lineHeight: 1.9 }}>
          <li><strong>Moderation (M1)</strong> — pending_review listing queue, approve / reject with mandatory reason_code on reject.</li>
          <li><strong>Disputes (M4)</strong> — side-by-side evidence workbench, decide (refund/release/split), dual-approval over ₦500,000.</li>
          <li><strong>Flags</strong> — safety/content flags on listings, users, reviews, and chat messages.</li>
          <li><strong>Orders Aging</strong> — stuck/aging non-terminal escrow orders dashboard (read-only).</li>
          <li><strong>Boosts</strong> — scaffolded; reject-with-reason (automatic refund) wired.</li>
          <li><strong>Audit Log</strong> — read-only, append-only record of every admin mutation.</li>
        </ul>
      </Card>
    </div>
  );
}
