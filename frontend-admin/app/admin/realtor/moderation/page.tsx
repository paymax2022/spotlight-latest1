'use client';

import { useEffect, useState } from 'react';
import { getModerationQueue, decideListing } from '@/services/realtorAdminService';
import type { AdminListing } from '@/types/realtorAdmin';
import { RealtorTabs, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'verified':
    case 'approved':
      return colors.success;
    case 'pending':
      return colors.warning;
    case 'rejected':
      return colors.danger;
    default:
      return colors.secondary;
  }
}

export default function ModerationPage() {
  const [rows, setRows] = useState<AdminListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getModerationQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    try { await decideListing(id, decision); setRows((r) => r.filter((x) => x.id !== id)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Listing moderation" subtitle="Approve or reject listings before they go live. AI risk flags are surfaced per item." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <RealtorTabs active="moderation" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading queue…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>Queue clear — no listings waiting for review.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Listing</th><th style={thCell}>Owner</th><th style={thCell}>Price</th><th style={thCell}>Verification</th><th style={thCell}>Risk</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.title}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{r.area}, {r.city} · {r.mode.replace('_', ' ')} · {timeAgo(r.submittedAt)}</div></td>
                  <td style={tdCell}>{r.ownerName}{r.ownerVerified ? ' ✓' : ''}</td>
                  <td style={tdCell}>{money(r.priceKobo)}</td>
                  <td style={tdCell}><Badge text={r.verification} color={statusColor(r.verification)} /></td>
                  <td style={tdCell}>{r.riskFlags.length === 0 ? <span style={{ color: colors.success }}>Clean</span> : <span style={{ color: colors.warning }}>{r.riskFlags.join('; ')}</span>}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Button sm variant="primary" disabled={busy === r.id} onClick={() => decide(r.id, 'approved')}>Approve</Button>
                      <Button sm variant="danger" disabled={busy === r.id} onClick={() => decide(r.id, 'rejected')}>Reject</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
