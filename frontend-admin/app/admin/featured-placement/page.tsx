'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { Campaign, ReviewQueueFilters } from '@/types/featuredPlacementAdmin';
import { CAMPAIGN_STATES } from '@/types/featuredPlacementAdmin';
import { listReviewQueue, naira, formatWindow } from '@/services/featuredPlacementAdminService';
import { StatusBadge } from './statusBadge';

// Default the queue to the states reviewers act on first.
const STATE_OPTIONS: Array<[string, string]> = [
  ['UNDER_REVIEW', 'Under review'],
  ['SUBMITTED', 'Submitted'],
  ['NEEDS_MORE_INFO', 'Needs more info'],
  ['', 'All states'],
  ...CAMPAIGN_STATES.filter(
    (s) => !['UNDER_REVIEW', 'SUBMITTED', 'NEEDS_MORE_INFO'].includes(s),
  ).map((s) => [s, s.replace(/_/g, ' ')] as [string, string]),
];

const defaultFilters: ReviewQueueFilters = { state: 'UNDER_REVIEW' };

export default function FeaturedPlacementQueuePage() {
  const [filters, setFilters] = useState<ReviewQueueFilters>(defaultFilters);
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listReviewQueue(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Featured Placement</h1>
      <p>Review queue for sponsored featured-placement campaigns awaiting moderation.</p>
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filters.state ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
        >
          {STATE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} campaign(s)</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No campaigns match the current filter.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Zone', 'Subject', 'Merchant', 'Window', 'Price', 'State', ''].map((h) => (
                <th key={h} style={{ padding: '8px 6px', fontWeight: 600, opacity: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                <td style={{ padding: '8px 6px' }}>
                  <Link href={`/admin/featured-placement/${c.id}`}>
                    <strong>{c.zone_code}</strong>
                  </Link>
                  <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{c.id}</div>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {c.subject_type}
                  <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{c.subject_id}</div>
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {c.merchant_name ?? c.merchant_id}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {formatWindow(c.window_start, c.window_end)}
                  <div style={{ fontSize: 11, opacity: 0.5 }}>{c.duration_days}d</div>
                </td>
                <td style={{ padding: '8px 6px' }}>{naira(c.quoted_price_kobo)}</td>
                <td style={{ padding: '8px 6px' }}><StatusBadge status={c.state} /></td>
                <td style={{ padding: '8px 6px' }}>
                  <Link href={`/admin/featured-placement/${c.id}`}>Review →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
