'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAmbassadors, formatNaira } from '@/services/referralAdminOpsService';
import type { Ambassador } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Ambassadors & Agents — Directory & tiers"
        subtitle="Manage ambassadors and agents, tier assignment and performance oversight (A-AMB-01/05)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href} style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>{l.label}</Link>)}
      </div>

      <Card title="Directory" right={
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {TIERS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All tiers' : t}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No ambassadors / agents.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Name</th><th style={th()}>Tier</th><th style={th()}>Status</th>
              <th style={th()}>Network</th><th style={th()}>Earned</th><th style={th()}>Override</th><th style={th()}>Joined</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((a) => (
                <tr key={a.id}>
                  <td style={td()}><Link href={`/admin/referral/users/${a.id}`} style={{ color: '#340075', fontWeight: 600 }}>{a.name}</Link><br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{a.id}</code></td>
                  <td style={td()}><Badge status="normal" label={a.tier} /></td>
                  <td style={td()}><Badge status={a.status === 'active' ? 'active' : a.status === 'suspended' ? 'critical' : 'high'} label={a.status} /></td>
                  <td style={td()}>{a.network_size}</td>
                  <td style={td()}>{formatNaira(a.total_earned_kobo)}</td>
                  <td style={td()}>{formatNaira(a.override_earned_kobo)}</td>
                  <td style={td()}>{timeAgo(a.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
