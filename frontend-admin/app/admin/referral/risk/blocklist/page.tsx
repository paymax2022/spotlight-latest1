'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listBlocklist } from '@/services/referralAdminOpsService';
import type { BlocklistEntry } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

export default function BlocklistPage() {
  const [rows, setRows] = useState<BlocklistEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listBlocklist(list)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [list]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Risk — Blocklists & allowlists"
        subtitle="Block or allow devices, identities, accounts and bank details (A-RSK-04)."
        action={<Link href="/admin/referral/risk" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Dashboard</Link>}
      />

      <Card title="Entries" right={
        <select value={list} onChange={(e) => setList(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          <option value="all">All lists</option>
          <option value="block">Blocklist</option>
          <option value="allow">Allowlist</option>
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No entries.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>List</th><th style={th()}>Type</th><th style={th()}>Value</th>
              <th style={th()}>Reason</th><th style={th()}>Added by</th><th style={th()}>When</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((b) => (
                <tr key={b.id}>
                  <td style={td()}><Badge status={b.list === 'block' ? 'critical' : 'active'} label={b.list} /></td>
                  <td style={td()}>{b.type}</td>
                  <td style={td()}><code style={{ fontSize: '0.8rem' }}>{b.value}</code></td>
                  <td style={td()}>{b.reason}</td>
                  <td style={td()}>{b.added_by}</td>
                  <td style={td()}>{timeAgo(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
