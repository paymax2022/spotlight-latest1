'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listNetworks, formatNaira } from '@/services/referralAdminOpsService';
import type { AgentNetwork } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, StateBlock } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Ambassadors — Agent network management"
        subtitle="Downline structures, depth and caps (A-AMB-03). Overrides are activity-based on verified network revenue only."
        action={<Link href="/admin/referral/ambassadors" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Directory</Link>}
      />

      <Card title="Agent networks">
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No networks.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Agent</th><th style={th()}>Depth</th><th style={th()}>Downline</th>
              <th style={th()}>Verified activity</th><th style={th()}>Override paid</th><th style={th()}>Cap check</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map((n) => (
                <tr key={n.id}>
                  <td style={td()}><Link href={`/admin/referral/users/${n.agent_id}`} style={{ color: '#340075', fontWeight: 600 }}>{n.agent_name}</Link></td>
                  <td style={td()}>{n.depth} / {n.max_depth_cap}</td>
                  <td style={td()}>{n.downline_count}</td>
                  <td style={td()}>{formatNaira(n.verified_activity_kobo)}</td>
                  <td style={td()}>{formatNaira(n.override_paid_kobo)}</td>
                  <td style={td()}><Badge status={n.depth <= n.max_depth_cap ? 'active' : 'critical'} label={n.depth <= n.max_depth_cap ? 'within cap' : 'over cap'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
