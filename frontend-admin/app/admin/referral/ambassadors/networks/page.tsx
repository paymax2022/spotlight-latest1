'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listAgentNetworks, type AgentNetworkRow } from '@/services/referralAdminOpsService';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// A-AMB-03 — Agent networks directory.
//
// Reads GET /api/referral/admin/network/networks. The page previously showed
// depth / max-depth cap / verified activity / override paid from mock data; the
// referral API exposes none of those, so they are not rendered. What it does
// expose — member counts and how many of those are house-attributed — is more
// useful anyway: house-attributed members are excluded from override chains
// (§7A.2), so that column is the share of a network that cannot pay overrides.

const STATUSES = ['all', 'active', 'suspended'];

export default function NetworksPage() {
  const [rows, setRows] = useState<AgentNetworkRow[] | null>(null);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAgentNetworks(status)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <Page>
      <PageHeader
        title="Ambassadors — Agent networks"
        subtitle="Agent networks and their membership (A-AMB-03). House-attributed members are excluded from override chains (§7A.2)."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <Link href="/admin/referral/ambassadors"><Button variant="outline">← Directory</Button></Link>
          </div>
        }
      />

      {error && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Could not load networks:</strong>
          <div style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 6 }}>{error}</div>
          <div style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 10 }}>
            Viewing needs the <code>referral.amb.view</code> permission.
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Networks</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ textTransform: 'capitalize', padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', background: colors.card, color: colors.text }}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No agent networks.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr>
                  <th style={thCell}>Network</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Members</th>
                  <th style={thCell}>House-attributed</th>
                  <th style={thCell}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td style={tdCell}>
                      <Link href={`/admin/referral/users/${n.leadUserId}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        {n.name || 'Unnamed network'}
                      </Link>
                      <br /><code style={{ fontSize: '0.72rem', color: colors.muted }}>lead {n.leadUserId.slice(0, 8)}…</code>
                    </td>
                    <td style={{ ...tdCell, textTransform: 'capitalize' }}>{n.networkType}</td>
                    <td style={tdCell}>
                      <Badge text={n.status} color={n.status === 'active' ? colors.success : colors.muted} />
                    </td>
                    <td style={tdCell}>{n.memberCount}</td>
                    <td style={tdCell}>
                      {n.houseAttributedCount > 0
                        ? <Badge text={`${n.houseAttributedCount} excluded`} color={colors.warning} />
                        : <span style={{ color: colors.muted }}>—</span>}
                    </td>
                    <td style={tdCell}>{timeAgo(n.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
