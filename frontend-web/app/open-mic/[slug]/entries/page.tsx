import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import { clientEntryRows, standingsSwitches } from '@/src/features/openmic/standings-visibility';
import OpenMicEntriesBoard from '@/components/openmic/OpenMicEntriesBoard';

export const dynamic = 'force-dynamic';

export default async function OpenMicEntriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);
  const { showLeaderboard, showVoteCounts } = standingsSwitches(contest.votingConfig);

  return (
    <section
      className="section-padding fix"
      style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', minHeight: '80vh' }}
    >
      <div className="container">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div
          className="rounded-3 p-4 p-md-5 mb-5"
          style={{
            background: 'linear-gradient(135deg,#1a1140 0%,#2d1f6e 100%)',
            border: '1px solid rgba(245,158,11,0.25)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'absolute', top: -50, right: -50, width: 180, height: 180,
            borderRadius: '50%', background: 'rgba(245,158,11,0.07)', pointerEvents: 'none',
          }} />

          <span style={{
            display: 'inline-block', background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b',
            fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
          }}>
            {showLeaderboard ? '🗳 Public Voting Board' : '🗳 Voting Now Open'}
          </span>
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 'clamp(1.5rem,4vw,2.2rem)', marginBottom: 6 }}>
            {contest.title}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 520, marginBottom: 16 }}>
            {showLeaderboard
              ? "Listen to every entry, support your favourite artist, and help decide this month's finalists."
              : "The organiser has taken this round's rankings down. You can still vote through the entry links artists share."}
          </p>

          <div className="d-flex flex-wrap gap-2 align-items-center">
            <Link href={`/open-mic/${contest.slug}`}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                color: '#e2e8f0', fontWeight: 600, fontSize: 12, padding: '8px 18px',
                borderRadius: 8, textDecoration: 'none',
              }}>
              ← Contest Details
            </Link>
            <Link href={`/open-mic/${contest.slug}/enter`}
              style={{
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
                color: '#f59e0b', fontWeight: 700, fontSize: 12, padding: '8px 18px',
                borderRadius: 8, textDecoration: 'none',
              }}>
              Submit Your Song
            </Link>
          </div>


        </div>

        {/* ── Voting board ──────────────────────────────────────────────── */}
        {showLeaderboard ? (
          <OpenMicEntriesBoard
            contestId={contest.id}
            contestSlug={contest.slug}
            entries={clientEntryRows(
              leaderboard
                .filter((e) => e.stageName && e.stageName.trim())
                .map((e) => ({
                  id: e.id,
                  stageName: e.stageName,
                  songTitle: e.songTitle || e.stageName,
                  songUrl: e.songUrl,
                  voteCount: e.voteCount,
                  status: e.status,
                })),
              { showLeaderboard, showVoteCounts },
            )}
            votePriceNgn={contest.votingConfig.votePrice}
            paidVoting={contest.votingConfig.paidVoting}
            freeVoting={contest.votingConfig.freeVoting}
            showVoteCounts={showVoteCounts}
          />
        ) : (
          /* One sentence with step #05 on the programme page: an artist's shared link
             can land a reader here, and the two pages must not disagree. */
          <div style={{
            padding: '28px 24px', borderRadius: 16,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, marginBottom: 8, fontWeight: 700 }}>
              This edition keeps its standings private until the results are announced.
            </p>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 0 }}>
              The ranking and the vote counts are hidden for now. Entry links that artists share still open, so you can listen and vote.
            </p>
          </div>
        )}

      </div>
    </section>
  );
}
