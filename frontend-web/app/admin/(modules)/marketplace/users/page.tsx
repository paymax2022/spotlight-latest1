'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { searchUsers } from '@/services/marketplaceAdminService';
import type { MktUserAdmin, MktUserStatus } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, FilterBar,
  PermissionBanner, btn, input, th, td, select, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

const STATUS_OPTIONS: MktUserStatus[] = ['active', 'suspended', 'banned'];

function fraudColor(score: number): string {
  return score >= 0.7 ? '#b91c1c' : score >= 0.4 ? '#9a3412' : '#15803d';
}

export default function UsersPage() {
  const { allowed: canView } = useMarketplacePermission(MARKETPLACE_PERMS.usersView, MARKETPLACE_PERMS.usersAction);
  const [rows, setRows] = useState<MktUserAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<MktUserStatus | ''>('');
  const [highRiskOnly, setHighRiskOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await searchUsers({ q: q || undefined, status: status || undefined, minFraud: highRiskOnly ? 0.7 : undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q, status, highRiskOnly]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Users & Trust"
        subtitle="Search users (PII masked), review KYC, and take account actions. Bans require a second approver."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="users" />
      <DisclosureNote>
        PII is masked here (USR-001) — you see enough to act, not enough to leak. Suspend/reinstate execute immediately;
        a <strong>ban</strong> is maker-checker (a different admin must confirm, USR-007). Every action is audited.
      </DisclosureNote>

      {!canView && <PermissionBanner permission={MARKETPLACE_PERMS.usersView} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div>
          <label style={lbl()}>Search</label>
          <input style={input()} placeholder="name, id, or masked email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label style={lbl()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as MktUserStatus | '')}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#374151' }}>
          <input type="checkbox" checked={highRiskOnly} onChange={(e) => setHighRiskOnly(e.target.checked)} /> High fraud risk only
        </label>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No users match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>User</th><th style={th()}>Status</th><th style={th()}>KYC</th>
              <th style={th()}>Trust</th><th style={th()}>Fraud risk</th><th style={th()}>Flags</th>
              <th style={th()}>Activity</th><th style={th()}>Last seen</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>{u.display_name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{u.email_masked} · {u.phone_masked}</div>
                  </td>
                  <td style={td()}><StatusBadge status={u.status === 'banned' ? 'removed_policy' : u.status === 'suspended' ? 'paused' : 'active'} />{u.status === 'banned' ? <span style={{ marginLeft: 4, fontSize: '0.7rem', color: '#b91c1c' }}>banned</span> : null}</td>
                  <td style={td()}>{u.kyc_tier.replace(/_/g, ' ')}{u.kyc_pending ? <div style={{ fontSize: '0.7rem', color: '#9a3412' }}>review pending</div> : null}</td>
                  <td style={td()}>{(u.trust_score * 5).toFixed(1)}</td>
                  <td style={td()}><span style={{ fontWeight: 700, color: fraudColor(u.fraud_score) }}>{Math.round(u.fraud_score * 100)}</span></td>
                  <td style={td()}>{u.open_flags > 0 ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{u.open_flags}</span> : '0'}</td>
                  <td style={td()}>{u.active_listings} listings · {u.completed_deals} deals</td>
                  <td style={td()}>{timeAgo(u.last_active_at)}</td>
                  <td style={td()}><Link href={`/admin/marketplace/users/${u.id}`} style={{ ...btn(), textDecoration: 'none' }}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
