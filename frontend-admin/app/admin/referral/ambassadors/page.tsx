'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAmbassadors, formatNaira } from '@/services/referralAdminOpsService';
import type { Ambassador } from '@/types/referralAdminOps';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const TIERS = ['all', 'Ambassador', 'Agent'];
const links = [
  { href: '/admin/referral/ambassadors/applications', label: 'Applications' },
  { href: '/admin/referral/ambassadors/networks', label: 'Agent networks' },
  { href: '/admin/referral/ambassadors/override-policy', label: 'Override policy' },
];

export default function AmbassadorsDirectoryPage() {
  const [rows, setRows] = useState<Ambassador[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAmbassadors(tier)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tier]);

  return (
    <Page>
      <PageHeader
        title="Ambassadors & Agents — Directory & tiers"
        subtitle="Manage ambassadors and agents, tier assignment and performance oversight (A-AMB-01/05)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href}><Button variant="outline" sm>{l.label}</Button></Link>)}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Directory</h2>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIERS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All tiers' : t}</option>)}
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
              <th style={thCell}>Name</th><th style={thCell}>Tier</th><th style={thCell}>Status</th>
              <th style={thCell}>Network</th><th style={thCell}>Earned</th><th style={thCell}>Override</th><th style={thCell}>Joined</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><Link href={`/admin/referral/users/${a.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>{a.name}</Link><br /><code style={{ fontSize: '0.72rem', color: colors.muted }}>{a.id}</code></td>
                  <td style={tdCell}><Badge text={a.tier} color={colors.info} /></td>
                  <td style={tdCell}><Badge text={a.status} color={a.status === 'active' ? colors.success : a.status === 'suspended' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}>{a.network_size}</td>
                  <td style={tdCell}>{formatNaira(a.total_earned_kobo)}</td>
                  <td style={tdCell}>{formatNaira(a.override_earned_kobo)}</td>
                  <td style={tdCell}>{timeAgo(a.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
