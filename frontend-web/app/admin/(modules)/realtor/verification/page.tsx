'use client';

import { useEffect, useState } from 'react';
import { getVerificationQueue, decideVerification } from '@/services/realtorAdminService';
import type { VerificationRequest } from '@/types/realtorAdmin';
import { PageHeader, RealtorTabs, Card, Badge, btn, btnPrimary, th, td, timeAgo } from '../_ui';

export default function VerificationPage() {
  const [rows, setRows] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getVerificationQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(id: string, status: 'approved' | 'rejected' | 'more_info') {
    setBusy(id);
    try { await decideVerification(id, status); setRows((r) => r.filter((x) => x.id !== id)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Verification queue" subtitle="Owner, agent, developer, vendor and property document review — the anti-scam control." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <RealtorTabs active="verification" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No verification requests pending.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Subject</th><th style={th()}>Type</th><th style={th()}>Documents</th><th style={th()}>Risk</th><th style={th()}>Submitted</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const missing = r.documents.filter((d) => !d.uploaded);
                return (
                  <tr key={r.id}>
                    <td style={td()}><strong>{r.subjectName}</strong></td>
                    <td style={td()}><Badge status={r.kind} /></td>
                    <td style={td()}>{r.documents.map((d) => d.label + (d.uploaded ? ' ✓' : ' ✗')).join(', ')}</td>
                    <td style={td()}>{r.riskNote ? <span style={{ color: '#d97706' }}>{r.riskNote}</span> : missing.length ? <span style={{ color: '#d97706' }}>{missing.length} doc(s) missing</span> : <span style={{ color: '#16a34a' }}>Complete</span>}</td>
                    <td style={td()}>{timeAgo(r.submittedAt)}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button disabled={busy === r.id} onClick={() => decide(r.id, 'approved')} style={btnPrimary('#16a34a')}>Approve</button>
                        <button disabled={busy === r.id} onClick={() => decide(r.id, 'more_info')} style={btnPrimary('#d97706')}>More info</button>
                        <button disabled={busy === r.id} onClick={() => decide(r.id, 'rejected')} style={btnPrimary('#dc2626')}>Reject</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
