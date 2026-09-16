'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Page, PageHeader, Card, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests, getContestRoster } from '@/services/competitionsService';
import type { VotingContest, ContestRosterEntry } from '@/types/competitions';

// Real leaderboard — GET /api/v1/connect/contests/:id/contestants, already
// ranked by total votes server-side. Previously this page picked from a
// MOCK_DATA map keyed by fake slugs ('open-mic-q3' etc.) with invented
// participant names, scores and prize amounts; "Publish Results" and "Send"
// prize buttons only called alert(). There is no prize-distribution /
// claim-tracking feature anywhere in the real backend, so that part of the
// old UI is gone rather than faked — this shows exactly what the backend
// tracks: free/paid/total votes per contestant, ranked.

function CompetitionsResultsContent() {
  const searchParams = useSearchParams();
  const initialContestId = searchParams.get('contestId') ?? '';

  const [contests, setContests] = useState<VotingContest[]>([]);
  const [selectedContestId, setSelectedContestId] = useState(initialContestId);
  const [roster, setRoster] = useState<ContestRosterEntry[]>([]);
  const [loadingContests, setLoadingContests] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingContests(true);
      try {
        const list = await listVotingContests();
        setContests(list);
        if (!selectedContestId && list.length > 0) setSelectedContestId(list[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load contests');
      } finally {
        setLoadingContests(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  const loadRoster = useCallback(async (contestId: string) => {
    if (!contestId) { setRoster([]); return; }
    setLoadingRoster(true);
    setError(null);
    try {
      setRoster(await getContestRoster(contestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  useEffect(() => { void loadRoster(selectedContestId); }, [selectedContestId, loadRoster]);

  const selectedContest = contests.find((c) => c.id === selectedContestId) ?? null;

  return (
    <Page>
      <PageHeader
        title="Results & Leaderboard"
        subtitle="Live vote tallies per contestant, ranked by total votes. Served from the Go backend's voting engine."
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Select contest" style={{ marginBottom: 16 }}>
        {loadingContests ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading contests…</p>
        ) : contests.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No contests found.</p>
        ) : (
          <select
            value={selectedContestId}
            onChange={(e) => setSelectedContestId(e.target.value)}
            style={{
              padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
              fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text, width: '100%', maxWidth: 400,
            }}
          >
            {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </Card>

      {selectedContest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Contestants</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>{selectedContest.contestant_count}</div>
          </div>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
            <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Votes</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>{selectedContest.total_votes.toLocaleString()}</div>
          </div>
        </div>
      )}

      <Card title="Leaderboard" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Rank</th>
              <th style={thCell}>Contestant</th>
              <th style={thCell}>Free Votes</th>
              <th style={thCell}>Paid Votes</th>
              <th style={thCell}>Total Votes</th>
              <th style={thCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loadingRoster ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={6}>Loading…</td></tr>
            ) : roster.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={6}>No contestants yet.</td></tr>
            ) : (
              roster.map((entry) => (
                <tr key={entry.contestant_id} style={{ background: entry.rank === 1 ? tint(colors.warning, 0.06) : 'transparent' }}>
                  <td style={tdCell}><span style={{ fontSize: '1.1rem', fontWeight: 700, color: colors.primary }}>#{entry.rank}</span></td>
                  <td style={tdCell}>
                    <strong>{entry.name}</strong>
                    {entry.stage_name ? <div style={{ fontSize: 12, color: colors.muted }}>&ldquo;{entry.stage_name}&rdquo;</div> : null}
                  </td>
                  <td style={tdCell}>{entry.free_votes.toLocaleString()}</td>
                  <td style={tdCell}>{entry.paid_votes.toLocaleString()}</td>
                  <td style={tdCell}><strong>{entry.total_votes.toLocaleString()}</strong></td>
                  <td style={tdCell}>{entry.is_active ? entry.status : `${entry.status} (inactive)`}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

export default function CompetitionsResultsPage() {
  return (
    <Suspense fallback={<Page><p style={{ color: colors.muted }}>Loading…</p></Page>}>
      <CompetitionsResultsContent />
    </Suspense>
  );
}
