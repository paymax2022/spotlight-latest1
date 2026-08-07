'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listContentReports, moderatePost } from '@/services/connectNetworkAdminService';
import type { ContentReport, ReviewAction } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'open', 'reviewing', 'actioned', 'dismissed'];

function statusColor(status: string): string {
  if (status === 'actioned') return colors.success;
  if (status === 'dismissed') return colors.secondary;
  if (status === 'reviewing') return colors.info;
  return colors.warning;
}

export default function ConnectContentModerationPage() {
  const [rows, setRows] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listContentReports(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(r: ContentReport, action: ReviewAction) {
    setBusy(r.id);
    try { await moderatePost(r.postId, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Content moderation queue" subtitle="ADM-CN-01 · Reported posts & comments. Action routes to POST /networking/posts/:id/moderation." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading reports…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No content reports match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Type</th><th style={thCell}>Reason</th><th style={thCell}>AI codes</th><th style={thCell}>Author</th><th style={thCell}>Reporter</th><th style={thCell}>Status</th><th style={thCell}>When</th><th style={thCell}>Moderate</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><Badge text={r.contentType} color={colors.info} /><div style={{ color: colors.muted, fontSize: '0.72rem', marginTop: 2 }}>{r.contentId}</div></td>
                  <td style={tdCell}>{r.reason}</td>
                  <td style={tdCell}>{r.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{r.aiReasonCodes.map((c) => <Badge key={c} text={c} color={colors.warning} />)}</span> : <span style={{ color: colors.muted }}>none</span>}</td>
                  <td style={tdCell}>{r.authorId}</td>
                  <td style={tdCell}>{r.reporterId ?? 'system / AI'}</td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>{timeAgo(r.createdAt)}</td>
                  <td style={tdCell}>{r.status === 'open' || r.status === 'reviewing' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <Button variant="danger" sm disabled={busy === r.id} onClick={() => act(r, 'reject')}>Take down</Button>
                      <Button variant="outline" sm disabled={busy === r.id} onClick={() => act(r, 'flag')} style={{ color: colors.warning, borderColor: colors.warning }}>Escalate</Button>
                      <Button variant="outline" sm disabled={busy === r.id} onClick={() => act(r, 'approve')} style={{ color: colors.success, borderColor: colors.success }}>Dismiss</Button>
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
