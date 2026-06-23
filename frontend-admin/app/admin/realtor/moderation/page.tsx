'use client';

import { useEffect, useState } from 'react';
import { getModerationQueue, decideListing } from '@/services/realtorAdminService';
import type { AdminListing } from '@/types/realtorAdmin';
import { PageHeader, RealtorTabs, Card, Badge, btn, btnPrimary, th, td, money, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Listing moderation" subtitle="Approve or reject listings before they go live. AI risk flags are surfaced per item." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <RealtorTabs active="moderation" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Queue clear — no listings waiting for review.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Listing</th><th style={th()}>Owner</th><th style={th()}>Price</th><th style={th()}>Verification</th><th style={th()}>Risk</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.title}</strong><div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{r.area}, {r.city} · {r.mode.replace('_', ' ')} · {timeAgo(r.submittedAt)}</div></td>
                  <td style={td()}>{r.ownerName}{r.ownerVerified ? ' ✓' : ''}</td>
                  <td style={td()}>{money(r.priceKobo)}</td>
                  <td style={td()}><Badge status={r.verification} /></td>
                  <td style={td()}>{r.riskFlags.length === 0 ? <span style={{ color: '#16a34a' }}>Clean</span> : <span style={{ color: '#d97706' }}>{r.riskFlags.join('; ')}</span>}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button disabled={busy === r.id} onClick={() => decide(r.id, 'approved')} style={btnPrimary('#16a34a')}>Approve</button>
                      <button disabled={busy === r.id} onClick={() => decide(r.id, 'rejected')} style={btnPrimary('#dc2626')}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
