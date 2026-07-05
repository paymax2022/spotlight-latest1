'use client';

import { useEffect, useState } from 'react';
import { listReviews, moderateReview } from '@/services/staysAdminService';
import type { Review, ReviewStatus } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  FilterBar,
  StateBlock,
  btn,
  btnPrimary,
  btnDanger,
  th,
  td,
  select,
  label,
  timeAgo,
} from '../_ui';

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span style={{ color: '#f59e0b', whiteSpace: 'nowrap' }} title={`${rating}/5`}>
      {'★'.repeat(r)}
      <span style={{ color: '#d1d5db' }}>{'★'.repeat(5 - r)}</span>
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reviews moderation"
        subtitle="Moderate guest reviews — publish, reject or flag. Flagged reviews are highlighted for review."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
                <th style={th()}>Property</th>
                <th style={th()}>Author</th>
                <th style={th()}>Rating</th>
                <th style={th()}>Review</th>
                <th style={th()}>Flags</th>
                <th style={th()}>Response</th>
                <th style={th()}>Status</th>
                <th style={th()}>When</th>
                <th style={th()}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.status === 'flagged' ? { background: '#fffbeb' } : undefined}>
                  <td style={td()}>{r.property_name}</td>
                  <td style={td()}>{r.author_masked}</td>
                  <td style={td()}><Stars rating={r.rating} /></td>
                  <td style={{ ...td(), maxWidth: 280 }}>
                    <strong>{r.title}</strong>
                    <div style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.body}</div>
                  </td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {r.flags.length === 0 ? <span style={{ color: '#9ca3af' }}>—</span> : r.flags.map((f) => <Badge key={f} status="flagged" label={f.replace(/_/g, ' ')} />)}
                    </div>
                  </td>
                  <td style={td()}><Badge status={r.has_response ? 'published' : 'draft'} label={r.has_response ? 'Responded' : 'None'} /></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button style={btnPrimary()} disabled={busy === r.id} onClick={() => moderate(r.id, 'published')}>Publish</button>
                      <button style={btnDanger()} disabled={busy === r.id} onClick={() => moderate(r.id, 'rejected')}>Reject</button>
                      <button style={btn()} disabled={busy === r.id} onClick={() => moderate(r.id, 'flagged')}>Flag</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
