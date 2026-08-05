'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMentorshipReports, reviewMentorshipReport } from '@/services/connectNetworkAdminService';
import type { MentorshipReport, ReviewAction } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'open', 'escalated', 'resolved', 'dismissed'];

function severityColor(severity: string): string {
  if (severity === 'critical' || severity === 'high') return colors.danger;
  if (severity === 'normal') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Mentorship safety reports" subtitle="ADM-MN-01 · Safety escalations raised inside mentorship threads. Thread content stays in-app; only reason codes surface here." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading reports…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No mentorship reports match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Thread</th><th style={thCell}>Mentor → Mentee</th><th style={thCell}>Reason</th><th style={thCell}>AI codes</th><th style={thCell}>By</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>When</th><th style={thCell}>Review</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.75rem' }}>{m.threadId}</code></td>
                  <td style={tdCell}>{m.mentorId} → {m.menteeId}</td>
                  <td style={tdCell}>{m.reason}</td>
                  <td style={tdCell}>{m.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{m.aiReasonCodes.map((c) => <Badge key={c} text={c} color={colors.warning} />)}</span> : <span style={{ color: colors.muted }}>none</span>}</td>
                  <td style={tdCell}>{m.reporterRole}</td>
                  <td style={tdCell}><Badge text={m.severity} color={severityColor(m.severity)} /></td>
                  <td style={tdCell}><Badge text={m.status} color={m.status === 'resolved' ? colors.success : m.status === 'dismissed' ? colors.secondary : m.status === 'escalated' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(m.createdAt)}</td>
                  <td style={tdCell}>{m.status === 'open' || m.status === 'escalated' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <Button variant="outline" sm disabled={busy === m.id} onClick={() => act(m.id, 'approve')} style={{ color: colors.success, borderColor: tint(colors.success, 0.4) }}>Resolve</Button>
                      <Button variant="outline" sm disabled={busy === m.id} onClick={() => act(m.id, 'flag')} style={{ color: colors.warning, borderColor: tint(colors.warning, 0.4) }}>Escalate</Button>
                      <Button variant="outline" sm disabled={busy === m.id} onClick={() => act(m.id, 'reject')} style={{ color: colors.danger, borderColor: tint(colors.danger, 0.4) }}>Dismiss</Button>
                    </span>
                  ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
