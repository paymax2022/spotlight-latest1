'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listReferralUsers, formatNaira } from '@/services/referralAdminOpsService';
import type { ReferralUserSummary } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, input, th, td, timeAgo, StateBlock } from '../_ui';

const ROLES = ['all', 'referrer', 'ambassador', 'agent', 'merchant'];
const STATUSES = ['all', 'active', 'restricted', 'suspended'];

export default function ReferralUsersPage() {
  const [rows, setRows] = useState<ReferralUserSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReferralUsers({ role, status, q })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [role, status, q]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Users & Graph — User 360 (referral)"
        subtitle="All referral roles, earnings, referral counts and risk scores (A-USR-01). Open a user for manual intervention & support tools (A-USR-03/04)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      <Card title="Referral users" right={
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <input style={{ ...input(), width: 180 }} placeholder="Search name / id" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
            {ROLES.map((r) => <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No users match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>User</th><th style={th()}>Roles</th><th style={th()}>Status</th>
              <th style={th()}>Earned</th><th style={th()}>Referrals</th><th style={th()}>Risk</th><th style={th()}>Joined</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((u) => (
                <tr key={u.id}>
                  <td style={td()}><Link href={`/admin/referral/users/${u.id}`} style={{ color: '#340075', fontWeight: 600 }}>{u.name}</Link><br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{u.id}</code></td>
                  <td style={td()}>{u.roles.join(', ')}</td>
                  <td style={td()}><Badge status={u.status === 'active' ? 'active' : u.status === 'suspended' ? 'critical' : 'high'} label={u.status} /></td>
                  <td style={td()}>{formatNaira(u.total_earned_kobo)}</td>
                  <td style={td()}>{u.referrals_count}</td>
                  <td style={td()}><Badge status={u.risk_score >= 70 ? 'critical' : u.risk_score >= 40 ? 'high' : 'normal'} label={`${u.risk_score}`} /></td>
                  <td style={td()}>{timeAgo(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
