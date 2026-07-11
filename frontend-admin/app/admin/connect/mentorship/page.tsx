'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMentorshipReports, reviewMentorshipReport } from '@/services/connectNetworkAdminService';
import type { MentorshipReport, ReviewAction } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'open', 'escalated', 'resolved', 'dismissed'];

export default function ConnectMentorshipReportsPage() {
  const [rows, setRows] = useState<MentorshipReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listMentorshipReports(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: ReviewAction) {
    setBusy(id);
    try { await reviewMentorshipReport(id, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Mentorship safety reports" subtitle="ADM-MN-01 · Safety escalations raised inside mentorship threads. Thread content stays in-app; only reason codes surface here." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading reports…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No mentorship reports match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Thread</th><th style={th()}>Mentor → Mentee</th><th style={th()}>Reason</th><th style={th()}>AI codes</th><th style={th()}>By</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>When</th><th style={th()}>Review</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{m.threadId}</code></td>
                  <td style={td()}>{m.mentorId} → {m.menteeId}</td>
                  <td style={td()}>{m.reason}</td>
                  <td style={td()}>{m.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{m.aiReasonCodes.map((c) => <Badge key={c} status="high" label={c} />)}</span> : <span style={{ color: '#9ca3af' }}>none</span>}</td>
                  <td style={td()}>{m.reporterRole}</td>
                  <td style={td()}><Badge status={m.severity} /></td>
                  <td style={td()}><Badge status={m.status === 'resolved' ? 'resolved' : m.status === 'dismissed' ? 'closed' : m.status === 'escalated' ? 'critical' : 'open'} label={m.status} /></td>
                  <td style={td()}>{timeAgo(m.createdAt)}</td>
                  <td style={td()}>{m.status === 'open' || m.status === 'escalated' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <button disabled={busy === m.id} onClick={() => act(m.id, 'approve')} style={{ ...btn(), color: '#15803d', borderColor: '#bbf7d0' }}>Resolve</button>
                      <button disabled={busy === m.id} onClick={() => act(m.id, 'flag')} style={{ ...btn(), color: '#9a3412', borderColor: '#fed7aa' }}>Escalate</button>
                      <button disabled={busy === m.id} onClick={() => act(m.id, 'reject')} style={{ ...btn(), color: '#b91c1c', borderColor: '#fecaca' }}>Dismiss</button>
                    </span>
                  ) : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
