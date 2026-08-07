'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listIdentityReviews } from '@/services/connectAdminService';
import type { IdentityReview } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATES = ['all', 'pending', 'in_review', 'approved', 'rejected', 'resubmit'];

export default function ConnectIdentityPage() {
  const [rows, setRows] = useState<IdentityReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('all');

  const filter = useMemo(() => (state === 'all' ? undefined : state), [state]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listIdentityReviews(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <Page>
      <PageHeader title="Verification review queue" subtitle="Selfie/liveness + ID review (§11.2 AU-04). Raw verification documents are encrypted at rest and NEVER rendered inline — masked references only." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="overview" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            State
            <select value={state} onChange={(e) => setState(e.target.value)} style={{ textTransform: 'capitalize' }}>
              {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <span style={{ fontSize: '0.78rem', color: colors.muted }}>PII never logged — masked doc references only.</span>
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading review queue…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No verification reviews in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>User</th><th style={thCell}>Doc type</th><th style={thCell}>Badge target</th><th style={thCell}>Doc ref (masked)</th><th style={thCell}>Liveness</th><th style={thCell}>State</th><th style={thCell}>Submitted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><Link href={`/admin/connect/users/${r.user_id}`} style={{ color: colors.info, textDecoration: 'none' }}>{r.handle}</Link></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{r.doc_type.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><Badge text={r.badge_target} color={colors.info} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.doc_ref_masked}</code></td>
                  <td style={tdCell}>{r.liveness_score != null ? `${Math.round(r.liveness_score * 100)}%` : '—'}</td>
                  <td style={tdCell}><Badge text={r.state.replace(/_/g, ' ')} color={r.state === 'approved' ? colors.success : r.state === 'rejected' ? colors.danger : r.state === 'in_review' ? colors.info : colors.warning} /></td>
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
