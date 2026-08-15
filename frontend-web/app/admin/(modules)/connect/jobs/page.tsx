'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listJobModeration, reviewJob } from '@/services/connectNetworkAdminService';
import type { JobPosting, ReviewAction } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'pending', 'approved', 'rejected', 'flagged'];

export default function ConnectJobsModerationPage() {
  const [rows, setRows] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listJobModeration(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: ReviewAction) {
    setBusy(id);
    try { await reviewJob(id, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Job posting moderation" subtitle="ADM-JB-01 · Approve, reject or flag Phase-6 job postings. AI reason codes shown; poster trust is a band, not a score." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

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
        {loading ? <p style={{ color: colors.muted }}>Loading postings…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No job postings match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Title</th><th style={thCell}>Company</th><th style={thCell}>Type</th><th style={thCell}>AI codes</th><th style={thCell}>Poster trust</th><th style={thCell}>Status</th><th style={thCell}>Submitted</th><th style={thCell}>Review</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td style={tdCell}><strong>{j.title}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{j.location}</div></td>
                  <td style={tdCell}>{j.companyName}</td>
                  <td style={tdCell}>{j.employmentType.replace(/_/g, ' ')}</td>
                  <td style={tdCell}>{j.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{j.aiReasonCodes.map((c) => <Badge key={c} text={c} color={colors.warning} />)}</span> : <span style={{ color: colors.muted }}>none</span>}</td>
                  <td style={tdCell}><Badge text={j.posterTrustBand} color={colors.info} /></td>
                  <td style={tdCell}><Badge text={j.status} color={j.status === 'approved' ? colors.success : j.status === 'rejected' ? colors.danger : j.status === 'flagged' ? colors.warning : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(j.submittedAt)}</td>
                  <td style={tdCell}><ReviewButtons id={j.id} busy={busy === j.id} disabled={j.status !== 'pending' && j.status !== 'flagged'} onAct={act} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

function ReviewButtons({ id, busy, disabled, onAct }: { id: string; busy: boolean; disabled?: boolean; onAct: (id: string, a: ReviewAction) => void }) {
  if (disabled) return <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>;
  return (
    <span style={{ display: 'flex', gap: '0.35rem' }}>
      <Button variant="outline" sm disabled={busy} onClick={() => onAct(id, 'approve')} style={{ color: colors.success, borderColor: tint(colors.success, 0.4) }}>Approve</Button>
      <Button variant="outline" sm disabled={busy} onClick={() => onAct(id, 'flag')} style={{ color: colors.warning, borderColor: tint(colors.warning, 0.4) }}>Flag</Button>
      <Button variant="outline" sm disabled={busy} onClick={() => onAct(id, 'reject')} style={{ color: colors.danger, borderColor: tint(colors.danger, 0.4) }}>Reject</Button>
    </span>
  );
}
