'use client';

// Contest results — publish/lock screen.
//
// WHY THIS EXISTS
// Organizers had no way to compute and publish a final, tie-broken
// leaderboard for a round. Publishing is a ONE-TIME, IRREVERSIBLE action
// server-side (POST .../publish-results — no unpublish/undo endpoint), so
// this screen never offers an edit/unpublish control once a round is
// published: there is nothing real for it to call.
//
// Tie-break rule is fixed and NOT configurable server-side
// (total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC). It is
// shown here as read-only informational text wherever results appear —
// never as an editable setting.
//
// Contest picker reuses the same listVotingContests()/VotingContest pattern
// as the templates and packages pages. Round picker is net-new (no existing
// frontend-admin UI lists voting_rounds) and follows GET
// /api/admin/voting/rounds?contestId=, the same route + query-param shape
// already used server-side. Confirm-before-publish uses window.confirm,
// matching the templates page's delete-confirm — this codebase has no
// modal/dialog component (checked components/ui/vuexy.tsx), so a plain
// confirm() is the established convention, not a shortcut.

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listVotingRounds, getRoundResults, publishRoundResults,
  type VotingRound, type RoundResults,
} from '@/services/contestResultsService';
import { formatNaira } from '@/services/contestPrizesService';
import type { VotingContest } from '@/types/competitions';

function TieBreakNote({ rule }: { rule: string | null }) {
  return (
    <p style={{ fontSize: 12, color: colors.muted, margin: '8px 0 0' }}>
      Tie-break rule (fixed, not configurable): <code>{rule || 'total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC'}</code>
    </p>
  );
}

function ContestResultsInner() {
  const params = useSearchParams();
  const initialContestId = params.get('contestId') ?? '';

  const [contests, setContests] = useState<VotingContest[]>([]);
  const [contestId, setContestId] = useState(initialContestId);
  const [rounds, setRounds] = useState<VotingRound[]>([]);
  const [roundId, setRoundId] = useState('');
  const [results, setResults] = useState<RoundResults | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadContests = useCallback(async () => {
    try {
      const rows = await listVotingContests();
      setContests(rows);
      setContestId((current) => current || rows[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contests');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRounds = useCallback(async () => {
    if (!contestId) { setRounds([]); setRoundId(''); return; }
    setError(null);
    try {
      const rows = await listVotingRounds(contestId);
      setRounds(rows);
      setRoundId((current) => (rows.some((r) => r.id === current) ? current : rows[0]?.id || ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rounds');
    }
  }, [contestId]);

  const loadResults = useCallback(async () => {
    if (!roundId) { setResults(null); return; }
    setLoadingResults(true); setError(null);
    try {
      setResults(await getRoundResults(roundId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load results');
    } finally {
      setLoadingResults(false);
    }
  }, [roundId]);

  useEffect(() => { void loadContests(); }, [loadContests]);
  useEffect(() => { void loadRounds(); }, [loadRounds]);
  useEffect(() => { void loadResults(); }, [loadResults]);

  async function publish() {
    if (!roundId) return;
    const round = rounds.find((r) => r.id === roundId);
    const confirmed = window.confirm(
      `Propose publish & lock of final results for "${round?.name || roundId}"?\n\n` +
      'This proposes computing ranks with the fixed tie-break rule, assigning prizes by rank, and ' +
      'creating an IMMUTABLE results snapshot — a second approver (super_admin) must approve it in ' +
      'Contest Approvals before it actually executes. There is no unpublish or edit once executed. Continue?'
    );
    if (!confirmed) return;

    setPublishing(true); setError(null); setNotice(null);
    try {
      // Proposes only — does NOT execute in this request (SEC-005/G-MC
      // maker-checker). Do not set any local "done"/"published" flag off
      // this response; results.published stays false until a second
      // approver executes the proposal and the round's real status flips,
      // which loadResults() (backed by GET .../results) will reflect.
      const r = await publishRoundResults(roundId);
      setNotice(r.message || 'Proposed — awaiting a second approver.');
    } catch (e) {
      // 409: already published — "Results already published and locked for this round".
      setError(e instanceof Error ? e.message : 'Could not propose results publish');
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <Page><PageHeader title="Contest Results" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>;
  }

  const banner = (text: string, tone: 'danger' | 'success') => (
    <div style={{
      margin: '0 16px 16px', padding: 12, borderRadius: 6, fontSize: 13,
      background: tone === 'danger' ? '#fdecea' : '#eaf7ee',
      color: tone === 'danger' ? colors.danger : colors.success,
    }}>{text}</div>
  );

  const selectedRound = rounds.find((r) => r.id === roundId) || null;

  return (
    <Page>
      <PageHeader
        title="Contest Results"
        subtitle="Propose computing, publishing and locking a round's final tie-broken leaderboard. A second approver (super_admin) must approve before it executes — see Contest Approvals. Once executed, publishing is one-time and irreversible."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/admin/voting/approvals"><Button variant="outline">Contest Approvals</Button></Link>
            <Link href="/admin/voting/prizes"><Button variant="outline">Contest Prizes</Button></Link>
          </div>
        }
      />

      <Card>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="contest" style={{ fontSize: 13, color: colors.muted }}>Contest</label>
          <select
            id="contest"
            value={contestId}
            onChange={(e) => setContestId(e.target.value)}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, minWidth: 260 }}
          >
            {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>

          <label htmlFor="round" style={{ fontSize: 13, color: colors.muted }}>Round</label>
          <select
            id="round"
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, minWidth: 220 }}
            disabled={rounds.length === 0}
          >
            {rounds.length === 0 && <option value="">No rounds for this contest</option>}
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (#{r.roundNumber}) — {r.status}
              </option>
            ))}
          </select>
        </div>

        {error && banner(error, 'danger')}
        {notice && banner(notice, 'success')}

        {loadingResults && <div style={{ padding: 16, fontSize: 13, color: colors.muted }}>Loading results…</div>}

        {!loadingResults && roundId && results && (
          results.published ? (
            <div style={{ padding: 16 }}>
              <div style={{
                display: 'inline-block', marginBottom: 12, padding: '6px 12px', borderRadius: 6,
                background: '#eaf7ee', color: colors.success, fontSize: 13, fontWeight: 600,
              }}>
                Results are locked and immutable
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Rank</th>
                    <th style={thCell}>Contestant</th>
                    <th style={thCell}>Confirmed votes</th>
                    <th style={thCell}>Paid votes</th>
                    <th style={thCell}>Prize</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.length === 0 && (
                    <tr><td style={tdCell} colSpan={5}>No result rows returned.</td></tr>
                  )}
                  {results.results.map((row) => (
                    <tr key={row.contestantId}>
                      <td style={tdCell}>{row.rank}</td>
                      <td style={tdCell}>{row.contestantName || row.contestantId}</td>
                      <td style={tdCell}>{row.totalConfirmedVotes.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{row.paidVotes.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{row.prizeDescription || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <TieBreakNote rule={results.tieBreakRule} />
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <p style={{ fontSize: 13, color: colors.text }}>
                {selectedRound
                  ? `"${selectedRound.name}" has not been published yet.`
                  : 'This round has not been published yet.'}
              </p>
              <TieBreakNote rule={results.tieBreakRule} />
              <div style={{ marginTop: 16 }}>
                <Button variant="primary" disabled={publishing || !roundId} onClick={() => void publish()}>
                  {publishing ? 'Proposing…' : 'Propose Publish & Lock Results'}
                </Button>
              </div>
            </div>
          )
        )}

        {!loadingResults && !roundId && (
          <div style={{ padding: 16, fontSize: 13, color: colors.muted }}>
            Select a contest with at least one round to view or publish results.
          </div>
        )}
      </Card>
    </Page>
  );
}

export default function ContestResultsPage() {
  // useSearchParams needs a Suspense boundary under the app router.
  return (
    <Suspense fallback={<Page><PageHeader title="Contest Results" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>}>
      <ContestResultsInner />
    </Suspense>
  );
}
