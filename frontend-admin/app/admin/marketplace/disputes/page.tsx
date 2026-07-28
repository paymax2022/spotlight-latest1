'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listDisputesQueue, formatKobo, DUAL_APPROVAL_THRESHOLD_KOBO } from '@/services/marketplaceAdminService';
import type { MktDispute, MktDisputeStatus } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, FilterBar,
  btn, th, td, select, label as lbl, timeAgo, MARKETPLACE_PERMS, useMarketplacePermission, PermissionBanner,
} from '../_ui';

const STATUS_OPTIONS: MktDisputeStatus[] = ['opened', 'evidence_window', 'under_review', 'decided', 'executed', 'closed', 'appealed'];

export default function DisputesQueuePage() {
  const { allowed: canReview } = useMarketplacePermission(MARKETPLACE_PERMS.disputeReview);
  const [rows, setRows] = useState<MktDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MktDisputeStatus | ''>('under_review');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listDisputesQueue(status || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Dispute Workbench (M4)"
        subtitle="Escrow disputes awaiting admin decision. Orders over ₦500,000 require a second, distinct approver before funds move."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="disputes" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/disputes/queue</code> (RBAC <code>marketplace.admin.dispute.review</code>). Open a dispute for the
        side-by-side evidence view and to decide (refund buyer / release seller / split) with a mandatory reason_code.
        Dual-approval threshold: <strong>{formatKobo(DUAL_APPROVAL_THRESHOLD_KOBO)}</strong>.
      </DisclosureNote>

      {!canReview && <PermissionBanner permission={MARKETPLACE_PERMS.disputeReview} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div>
          <label style={lbl()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as MktDisputeStatus | '')}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No disputes match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Dispute</th><th style={th()}>Order</th><th style={th()}>Reason</th>
              <th style={th()}>Amount</th><th style={th()}>Dual-approval</th><th style={th()}>Status</th>
              <th style={th()}>Evidence deadline</th><th style={th()}>Opened</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((d) => {
                const amount = d.order?.amount_kobo ?? 0;
                const willDual = amount > DUAL_APPROVAL_THRESHOLD_KOBO;
                return (
                  <tr key={d.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.id}</code>{d.listing_title && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{d.listing_title}</div>}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.order_id}</code></td>
                    <td style={td()}>{d.reason_code.replace(/_/g, ' ')}</td>
                    <td style={td()}>{formatKobo(amount)}</td>
                    <td style={td()}>{willDual || d.requires_dual_approval ? <span style={{ color: '#1d4ed8', fontWeight: 600 }}>Required</span> : <span style={{ color: '#9ca3af' }}>No</span>}</td>
                    <td style={td()}><StatusBadge status={d.status} /></td>
                    <td style={td()}>{timeAgo(d.evidence_deadline)}</td>
                    <td style={td()}>{timeAgo(d.created_at)}</td>
                    <td style={td()}><Link href={`/admin/marketplace/disputes/${d.id}`} style={{ ...btn(), textDecoration: 'none', display: 'inline-block' }}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
