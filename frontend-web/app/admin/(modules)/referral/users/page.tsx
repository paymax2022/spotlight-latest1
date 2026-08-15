'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listReferralUsers, formatNaira } from '@/services/referralAdminOpsService';
import type { ReferralUserSummary } from '@/types/referralAdminOps';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const ROLES = ['all', 'referrer', 'ambassador', 'agent', 'merchant'];
const STATUSES = ['all', 'active', 'restricted', 'suspended'];

function statusBadgeColor(status: string): string {
  if (status === 'active') return colors.success;
  if (status === 'suspended') return colors.danger;
  return colors.warning;
}

function riskBadgeColor(score: number): string {
  if (score >= 70) return colors.danger;
  if (score >= 40) return colors.warning;
  return colors.info;
}

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
    <Page>
      <PageHeader
        title="Users & Graph — User 360 (referral)"
        subtitle="All referral roles, earnings, referral counts and risk scores (A-USR-01). Open a user for manual intervention & support tools (A-USR-03/04)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Referral users</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input style={{ width: 180 }} placeholder="Search name / id" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : (!rows || rows.length === 0) ? <p style={{ color: colors.muted }}>No users match.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>User</th><th style={thCell}>Roles</th><th style={thCell}>Status</th>
                    <th style={thCell}>Earned</th><th style={thCell}>Referrals</th><th style={thCell}>Risk</th><th style={thCell}>Joined</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.id}>
                        <td style={tdCell}><Link href={`/admin/referral/users/${u.id}`} style={{ fontWeight: 600 }}>{u.name}</Link><br /><code style={{ fontSize: 12, color: colors.muted }}>{u.id}</code></td>
                        <td style={tdCell}>{u.roles.join(', ')}</td>
                        <td style={tdCell}><Badge text={u.status} color={statusBadgeColor(u.status)} /></td>
                        <td style={tdCell}>{formatNaira(u.total_earned_kobo)}</td>
                        <td style={tdCell}>{u.referrals_count}</td>
                        <td style={tdCell}><Badge text={`${u.risk_score}`} color={riskBadgeColor(u.risk_score)} /></td>
                        <td style={tdCell}>{timeAgo(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>
    </Page>
  );
}
