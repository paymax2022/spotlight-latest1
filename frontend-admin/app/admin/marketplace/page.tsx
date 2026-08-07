'use client';

import { useEffect, useState } from 'react';
import {
  listModerationQueue, listFlags, listBoosts,
} from '@/services/marketplaceAdminService';
import { PageHeader, MarketplaceTabs, Card, Kpi, DisclosureNote } from './_ui';

export default function MarketplaceOverviewPage() {
  const [pendingListings, setPendingListings] = useState<number | null>(null);
  const [openFlags, setOpenFlags] = useState<number | null>(null);
  const [activeBoosts, setActiveBoosts] = useState<number | null>(null);

  useEffect(() => {
    void listModerationQueue().then((r) => setPendingListings(r.length)).catch(() => setPendingListings(null));
    void listFlags('open').then((r) => setOpenFlags(r.length)).catch(() => setOpenFlags(null));
    void listBoosts().then((r) => setActiveBoosts(r.filter((b) => b.status === 'active' || b.status === 'purchased').length)).catch(() => setActiveBoosts(null));
  }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Paymax Marketplace — Ops Console"
        subtitle="Moderation, safety flags, boosts, and audit oversight for the Jiji-style classifieds marketplace (listings + connect; no escrow — ADR-023)."
      />
      <MarketplaceTabs active="" />
      <DisclosureNote>
        Every mutating action across this console requires a <code>reason_code</code> and writes an immutable
        <code> mkt_admin_audit_log</code> row. Backend RBAC (<code>marketplace.admin.*</code>) is authoritative.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Listings pending review" value={pendingListings != null ? String(pendingListings) : '—'} accent={pendingListings && pendingListings > 0 ? '#9a3412' : undefined} />
        <Kpi label="Open safety flags" value={openFlags != null ? String(openFlags) : '—'} accent={openFlags && openFlags > 0 ? '#b91c1c' : undefined} />
        <Kpi label="Active boosts" value={activeBoosts != null ? String(activeBoosts) : '—'} accent={activeBoosts && activeBoosts > 0 ? '#15803d' : undefined} />
      </div>

      <Card title="Modules">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.88rem', color: '#374151', lineHeight: 1.9 }}>
          <li><strong>Moderation (M1)</strong> — pending_review listing queue, approve / reject with mandatory reason_code on reject.</li>
          <li><strong>Flags</strong> — safety/content flags on listings, users, reviews, and chat messages.</li>
          <li><strong>Boosts</strong> — boost purchases; reject-with-reason (automatic refund) wired.</li>
          <li><strong>Audit Log</strong> — read-only, append-only record of every admin mutation.</li>
        </ul>
      </Card>
    </div>
  );
}
