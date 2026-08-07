'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listBlocklist } from '@/services/referralAdminOpsService';
import type { BlocklistEntry } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Risk — Blocklists & allowlists"
        subtitle="Block or allow devices, identities, accounts and bank details (A-RSK-04)."
        actions={<Link href="/admin/referral/risk" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Dashboard</Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Entries</h2>
          <select value={list} onChange={(e) => setList(e.target.value)}>
            <option value="all">All lists</option>
            <option value="block">Blocklist</option>
            <option value="allow">Allowlist</option>
          </select>
        </div>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : (!rows || rows.length === 0) ? <p style={{ color: colors.muted }}>No entries.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>List</th><th style={thCell}>Type</th><th style={thCell}>Value</th>
                    <th style={thCell}>Reason</th><th style={thCell}>Added by</th><th style={thCell}>When</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td style={tdCell}><Badge text={b.list} color={b.list === 'block' ? colors.danger : colors.success} /></td>
                        <td style={tdCell}>{b.type}</td>
                        <td style={tdCell}><code style={{ fontSize: 13 }}>{b.value}</code></td>
                        <td style={tdCell}>{b.reason}</td>
                        <td style={tdCell}>{b.added_by}</td>
                        <td style={tdCell}>{timeAgo(b.created_at)}</td>
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
