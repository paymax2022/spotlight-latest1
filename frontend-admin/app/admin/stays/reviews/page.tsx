'use client';

import { useEffect, useState } from 'react';
import { listReviews, moderateReview } from '@/services/staysAdminService';
import type { Review, ReviewStatus } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  FilterBar,
  StateBlock,
  select,
  label,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span style={{ color: colors.warning, whiteSpace: 'nowrap' }} title={`${rating}/5`}>
      {'★'.repeat(r)}
      <span style={{ color: colors.border }}>{'★'.repeat(5 - r)}</span>
    </span>
  );
}

export default function StaysReviewsPage() {
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReviews(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  async function moderate(id: string, next: ReviewStatus) {
    setBusy(id); setError(null);
    try { await moderateReview(id, { status: next }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Reviews moderation"
        subtitle="Moderate guest reviews — publish, reject or flag. Flagged reviews are highlighted for review."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="growth" />

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="published">Published</option>
            <option value="rejected">Rejected</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reviews found.">
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Property</th>
                <th style={thCell}>Author</th>
                <th style={thCell}>Rating</th>
                <th style={thCell}>Review</th>
                <th style={thCell}>Flags</th>
                <th style={thCell}>Response</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>When</th>
                <th style={thCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.status === 'flagged' ? { background: tint(colors.warning, 0.08) } : undefined}>
                  <td style={tdCell}>{r.property_name}</td>
                  <td style={tdCell}>{r.author_masked}</td>
                  <td style={tdCell}><Stars rating={r.rating} /></td>
                  <td style={{ ...tdCell, maxWidth: 280 }}>
                    <strong>{r.title}</strong>
                    <div style={{ color: colors.muted, fontSize: '0.8rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.body}</div>
                  </td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {r.flags.length === 0 ? <span style={{ color: colors.muted }}>—</span> : r.flags.map((f) => <Badge key={f} status="flagged" label={f.replace(/_/g, ' ')} />)}
                    </div>
                  </td>
                  <td style={tdCell}><Badge status={r.has_response ? 'published' : 'draft'} label={r.has_response ? 'Responded' : 'None'} /></td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <Button variant="primary" sm disabled={busy === r.id} onClick={() => moderate(r.id, 'published')}>Publish</Button>
                      <Button variant="danger" sm disabled={busy === r.id} onClick={() => moderate(r.id, 'rejected')}>Reject</Button>
                      <Button variant="outline" sm disabled={busy === r.id} onClick={() => moderate(r.id, 'flagged')}>Flag</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
