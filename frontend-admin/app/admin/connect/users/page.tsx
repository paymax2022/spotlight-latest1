'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listConnectUsers, formatNaira } from '@/services/connectAdminService';
import type { ConnectUserSummary } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'active', 'suspended', 'banned', 'restricted', 'pending'];
const TIERS = ['all', '0', '1', '2', '3'];

export default function ConnectUsersPage() {
  const [rows, setRows] = useState<ConnectUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [tier, setTier] = useState('all');
  const [search, setSearch] = useState('');

  const opts = useMemo(() => ({
    status: status === 'all' ? undefined : status,
    tier: tier === 'all' ? undefined : Number(tier),
    search: search.trim() || undefined,
  }), [status, tier, search]);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listConnectUsers(opts)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [opts]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Users & identity" subtitle="User 360 — filter by tier, status, region and flags (§11.2)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <Select label="Tier" value={tier} options={TIERS} onChange={setTier} />
          <input placeholder="Search handle, name or id…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }} />
        </div>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading users…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No users match these filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>User</th><th style={th()}>Tier</th><th style={th()}>Verification</th><th style={th()}>Status</th><th style={th()}>Region</th><th style={th()}>Flags</th><th style={th()}>Wallet</th><th style={th()}>Active</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td style={td()}><strong>{u.display_name}</strong> <span style={{ color: '#6b7280' }}>{u.handle}</span></td>
                  <td style={td()}>T{u.tier}</td>
                  <td style={td()}><Badge status={u.verification === 'full' ? 'resolved' : 'normal'} label={u.verification} /></td>
                  <td style={td()}><Badge status={u.status === 'active' ? 'resolved' : u.status === 'banned' || u.status === 'suspended' ? 'critical' : u.status === 'restricted' ? 'high' : 'normal'} label={u.status} /></td>
                  <td style={td()}>{u.region}</td>
                  <td style={td()}>{u.flags.length ? u.flags.map((f) => <Badge key={f} status="high" label={f} />) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{formatNaira(u.wallet_balance_kobo)}</td>
                  <td style={td()}>{timeAgo(u.last_active_at)}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/connect/users/${u.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
