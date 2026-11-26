'use client';

/**
 * The Submissions tab of the Open Mic contest console, as a review queue.
 *
 * This tab used to render every hand-in twice: a read-only table of artist,
 * song, status, timestamp, votes and standings, and then a card per song
 * underneath carrying the player and the decision. Neither held the whole
 * story, so checking one song meant reading it in two places — and the rows
 * came back in API order, which put last week's published winners next to the
 * hand-ins nobody had listened to yet, with no way to narrow the list.
 *
 * So the table is gone and the card carries everything (see
 * `submission-review-card.tsx`), while this file is only the queue: what is
 * still outstanding, in what order, narrowed by scope and search, and moving
 * the operator to the next undecided song after each decision. The ordering and
 * filtering rules are pure functions in `submission-queue.ts`, pinned by
 * `tests/admin/openmic/submission-queue.test.ts`.
 *
 * A decided row stays mounted rather than dropping out of the filtered list the
 * instant its decision lands: the confirmation the operator just earned is on
 * that card, and unmounting it is what the old reload-the-tab behaviour did.
 * The refetch (`onRefresh`) is what eventually re-sorts and re-filters.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { OpenMicSubmissionRow } from '@/services/openMicAdminService';
import { SubmissionReviewCard } from '@/features/openmic/submission-review-card';
import {
  QUEUE_SCOPES,
  QUEUE_SCOPE_LABELS,
  isAwaitingDecision,
  orderQueue,
  queueCounts,
  type QueueScope,
} from '@/features/openmic/submission-queue';
import { colors, Button, Input } from '@/components/ui/vuexy';

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: colors.muted,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const controlStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${colors.inputBorder}`,
  fontSize: 13,
};

export default function OpenMicSubmissionReviewPanel({
  submissions,
  onRefresh,
  refreshing,
}: {
  submissions: OpenMicSubmissionRow[];
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  // The backlog is the default view: an operator opening this tab is here to
  // clear songs that still need a decision, not to re-read decided ones.
  const [scope, setScope] = useState<QueueScope>('awaiting');
  const [query, setQuery] = useState('');
  /** id → status returned by a decision made on this screen, overriding the row. */
  const [decidedHere, setDecidedHere] = useState<Record<string, string>>({});
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  // A new list from the server is authoritative; drop the local overrides so a
  // stale one can never mask what the row actually says now.
  useEffect(() => { setDecidedHere({}); }, [submissions]);

  const queue = useMemo(() => orderQueue(submissions, { scope, query }), [submissions, scope, query]);
  const counts = useMemo(() => queueCounts(submissions), [submissions]);
  const filtersActive = scope !== 'awaiting' || query.trim() !== '';

  // Land the keyboard on the row that still needs work. Scroll as well as
  // focus: the queue can be longer than the viewport and a focused-but-offscreen
  // select is indistinguishable from nothing happening.
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById(`decision-${focusTarget}`);
    if (element) {
      // Optional call on purpose: jsdom implements no scrollIntoView, and a
      // throw inside a passive effect unmounts the whole tree. Every browser
      // this console runs in has it.
      element.scrollIntoView?.({ block: 'center' });
      element.focus();
    }
    setFocusTarget(null);
  }, [focusTarget, queue]);

  const handleDecided = useCallback((id: string, newStatus: string) => {
    const merged = { ...decidedHere, [id]: newStatus };
    setDecidedHere(merged);
    const next = queue.find((row) => row.id !== id && isAwaitingDecision(merged[row.id] ?? row.status));
    if (next) setFocusTarget(next.id);
    onRefresh();
  }, [decidedHere, queue, onRefresh]);

  function clearFilters() {
    setScope('awaiting');
    setQuery('');
  }

  if (submissions.length === 0) {
    return <p style={{ color: colors.muted, margin: 0 }}>No songs handed in for this edition yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
            {counts.total} hand-in{counts.total === 1 ? '' : 's'}
            {` · ${counts.awaiting} awaiting a decision`}
            {` · ${counts.published} published for voting`}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: colors.muted }}>
            Listen, then decide. Only ‘Publish for voting’ puts a track on the artist profile, the leaderboard and the
            mobile app; ‘Approve the hand-in’ alone accepts the file and shows it to nobody.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <label htmlFor="submissions-search" style={labelStyle}>Search hand-ins</label>
            <Input
              id="submissions-search"
              aria-label="Search hand-ins"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Artist, song or genre"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="submissions-scope" style={labelStyle}>Which hand-ins to show</label>
            <select
              id="submissions-scope"
              aria-label="Which hand-ins to show"
              value={scope}
              onChange={(e) => setScope(e.target.value as QueueScope)}
              style={controlStyle}
            >
              {QUEUE_SCOPES.map((value) => (
                <option key={value} value={value}>{QUEUE_SCOPE_LABELS[value]}</option>
              ))}
            </select>
          </div>
          <Button sm onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div style={{ border: `1px dashed ${colors.inputBorder}`, borderRadius: 10, padding: 18, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>
            Nothing matches this filter. {scope === 'awaiting' && !query.trim()
              ? 'Every hand-in for this edition has been decided.'
              : 'Widen the search or switch the view to see the rest.'}
          </p>
          {filtersActive && (
            <Button sm onClick={clearFilters} style={{ marginTop: 10 }}>Clear filters</Button>
          )}
        </div>
      ) : (
        queue.map((row) => (
          <SubmissionReviewCard
            key={row.id}
            submission={row}
            status={decidedHere[row.id] ?? row.status}
            onDecided={handleDecided}
          />
        ))
      )}
    </div>
  );
}
