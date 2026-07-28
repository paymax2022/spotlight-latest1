'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listAppeals } from '@/services/marketplaceAdminService';
import type { MktAppeal, MktAppealStatus } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, FilterBar,
  PermissionBanner, btn, th, td, select, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

const STATUS_OPTIONS: MktAppealStatus[] = ['opened', 'under_review', 'decided', 'executed', 'closed'];

export default function AppealsQueuePage() {
  const { allowed: canReview } = useMarketplacePermission(MARKETPLACE_PERMS.appealsReview, MARKETPLACE_PERMS.appealsDecide);
  const [rows, setRows] = useState<MktAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MktAppealStatus | ''>('opened');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listAppeals(status || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Appeals"
        subtitle="Seller/user challenges to moderation decisions (listing removals, boost rejections, suspensions). Overturning a policy action is maker-checker."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="appeals" />
      <DisclosureNote>
        Upholding an appeal denies it (the original action stands, executes immediately). <strong>Overturning</strong> reverses a
        policy removal/suspension and requires a <strong>second, different</strong> approver before it executes (MOD-009). Every
        decision writes an audit row.
      </DisclosureNote>

      {!canReview && <PermissionBanner permission={MARKETPLACE_PERMS.appealsReview} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div>
          <label style={lbl()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as MktAppealStatus | '')}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No appeals match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Target</th><th style={th()}>Original action</th><th style={th()}>Appellant</th>
              <th style={th()}>Reason cited</th><th style={th()}>Status</th><th style={th()}>Raised</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={td()}>{a.target_type}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{a.target_id}</code></div></td>
                  <td style={td()}>{a.original_action.replace(/_/g, ' ')}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{a.original_reason_code.replace(/_/g, ' ')}</div></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.appellant_id}</code></td>
                  <td style={td()}><span style={{ maxWidth: 280, display: 'inline-block', color: '#4b5563' }}>{a.appellant_note}</span></td>
                  <td style={td()}>
                    <StatusBadge status={a.status} />
                    {a.decision ? <div style={{ fontSize: '0.72rem', color: a.decision === 'overturned' ? '#7c3aed' : '#6b7280', marginTop: 2 }}>{a.decision}{a.requires_dual_approval && !a.executed_at ? ' · awaiting 2nd' : ''}</div> : null}
                  </td>
                  <td style={td()}>{timeAgo(a.created_at)}</td>
                  <td style={td()}><Link href={`/admin/marketplace/appeals/${a.id}`} style={{ ...btn(), textDecoration: 'none' }}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
