'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { Campaign, ReviewQueueFilters } from '@/types/featuredPlacementAdmin';
import { CAMPAIGN_STATES } from '@/types/featuredPlacementAdmin';
import { listReviewQueue, naira, formatWindow } from '@/services/featuredPlacementAdminService';
import { StatusBadge } from './statusBadge';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Featured Placement"
        subtitle="Review queue for sponsored featured-placement campaigns awaiting moderation."
      />
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filters.state ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
        >
          {STATE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Button variant="outline" sm onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        <Button variant="secondary" sm onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{rows.length} campaign(s)</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No campaigns match the current filter.</p>
      ) : null}

      {rows.length > 0 ? (
        <Card style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Zone', 'Subject', 'Merchant', 'Window', 'Price', 'State', ''].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}>
                    <Link href={`/admin/featured-placement/${c.id}`}>
                      <strong>{c.zone_code}</strong>
                    </Link>
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{c.id}</div>
                  </td>
                  <td style={tdCell}>
                    {c.subject_type}
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{c.subject_id}</div>
                  </td>
                  <td style={tdCell}>
                    {c.merchant_name ?? c.merchant_id}
                  </td>
                  <td style={tdCell}>
                    {formatWindow(c.window_start, c.window_end)}
                    <div style={{ fontSize: 11, color: colors.muted }}>{c.duration_days}d</div>
                  </td>
                  <td style={tdCell}>{naira(c.quoted_price_kobo)}</td>
                  <td style={tdCell}><StatusBadge status={c.state} /></td>
                  <td style={tdCell}>
                    <Link href={`/admin/featured-placement/${c.id}`}>Review →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
