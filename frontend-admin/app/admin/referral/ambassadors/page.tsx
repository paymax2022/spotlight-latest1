'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAmbassadorQueue, type AmbassadorQueueRow } from '@/services/referralAdminOpsService';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// The backend filters this directory by lifecycle status, not by tier — there is
// no tier filter endpoint — so the control reflects what can actually be queried.
const STATUSES = ['all', 'applied', 'approved', 'suspended', 'rejected'];

const statusColor: Record<string, string> = {
  applied: colors.warning,
  approved: colors.success,
  suspended: colors.danger,
  rejected: colors.muted,
};
const links = [
  { href: '/admin/referral/ambassadors/applications', label: 'Applications' },
  { href: '/admin/referral/ambassadors/networks', label: 'Agent networks' },
  { href: '/admin/referral/ambassadors/override-policy', label: 'Override policy' },
];

export default function AmbassadorsDirectoryPage() {
  const [rows, setRows] = useState<AmbassadorQueueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAmbassadorQueue(status)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader
        title="Ambassadors & Agents — Directory & tiers"
        subtitle="Ambassador directory and lifecycle status (A-AMB-01/05). Network size and earnings are not exposed by the referral API."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href}><Button variant="outline" sm>{l.label}</Button></Link>)}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Directory</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATUSES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All statuses' : t}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No ambassadors / agents.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr>
              <th style={thCell}>Applicant</th><th style={thCell}>Tier</th><th style={thCell}>Status</th>
              <th style={thCell}>Disclosure</th><th style={thCell}>Applied</th><th style={thCell}>Decided</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}>
                    <Link href={`/admin/referral/users/${a.userId}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                      {a.userId.slice(0, 8)}…
                    </Link>
                    <br /><code style={{ fontSize: '0.72rem', color: colors.muted }}>{a.userId}</code>
                  </td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{a.tier}</td>
                  <td style={tdCell}><Badge text={a.status} color={statusColor[a.status] || colors.muted} /></td>
                  <td style={tdCell}>
                    {a.disclosureAcceptedAt
                      ? timeAgo(a.disclosureAcceptedAt)
                      : <span style={{ color: colors.danger, fontSize: '0.8rem' }}>missing</span>}
                  </td>
                  <td style={tdCell}>{timeAgo(a.appliedAt)}</td>
                  <td style={tdCell}>{a.approvedAt ? timeAgo(a.approvedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
