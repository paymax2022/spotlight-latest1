'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listNetworks, formatNaira } from '@/services/referralAdminOpsService';
import type { AgentNetwork } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function NetworksPage() {
  const [rows, setRows] = useState<AgentNetwork[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listNetworks()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Ambassadors — Agent network management"
        subtitle="Downline structures, depth and caps (A-AMB-03). Overrides are activity-based on verified network revenue only."
        actions={<Link href="/admin/referral/ambassadors"><Button variant="outline">← Directory</Button></Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text, padding: '14px 14px 0' }}>Agent networks</h2>
        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No networks.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr>
              <th style={thCell}>Agent</th><th style={thCell}>Depth</th><th style={thCell}>Downline</th>
              <th style={thCell}>Verified activity</th><th style={thCell}>Override paid</th><th style={thCell}>Cap check</th>
            </tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td style={tdCell}><Link href={`/admin/referral/users/${n.agent_id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>{n.agent_name}</Link></td>
                  <td style={tdCell}>{n.depth} / {n.max_depth_cap}</td>
                  <td style={tdCell}>{n.downline_count}</td>
                  <td style={tdCell}>{formatNaira(n.verified_activity_kobo)}</td>
                  <td style={tdCell}>{formatNaira(n.override_paid_kobo)}</td>
                  <td style={tdCell}><Badge text={n.depth <= n.max_depth_cap ? 'within cap' : 'over cap'} color={n.depth <= n.max_depth_cap ? colors.success : colors.danger} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
