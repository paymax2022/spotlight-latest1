'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listMediaReview } from '@/services/connectAdminService';
import type { MediaReviewItem } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATES = ['all', 'pending', 'approved', 'rejected'];

export default function ConnectMediaReviewPage() {
  const [rows, setRows] = useState<MediaReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('all');

  const filter = useMemo(() => (state === 'all' ? undefined : state), [state]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listMediaReview(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <Page>
      <PageHeader title="Media review" subtitle="Media is moderated BEFORE public visibility (§11.4 AM-09). AI reason codes shown; raw media is not rendered inline." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="cases" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          State
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ textTransform: 'capitalize' }}>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading media queue…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No media items in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>User</th><th style={thCell}>Media</th><th style={thCell}>AI reason codes</th><th style={thCell}>AI confidence</th><th style={thCell}>State</th><th style={thCell}>Submitted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><Link href={`/admin/connect/users/${r.user_id}`} style={{ color: colors.info, textDecoration: 'none' }}>{r.handle}</Link></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.media_kind.replace(/_/g, ' ')}</td>
                  <td style={tdCell}>{r.ai_reason_codes.length ? r.ai_reason_codes.map((c) => <Badge key={c} text={c} color={colors.warning} />) : <span style={{ color: colors.muted }}>clean</span>}</td>
                  <td style={tdCell}>{Math.round(r.ai_confidence * 100)}%</td>
                  <td style={tdCell}><Badge text={r.state} color={r.state === 'approved' ? colors.success : r.state === 'rejected' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
