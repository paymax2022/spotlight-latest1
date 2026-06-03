import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import { slugifyArtist } from '@/src/features/openmic/workflow';
import OpenMicArtistVotingCard from '@/components/openmic/OpenMicArtistVotingCard';

export const dynamic = 'force-dynamic';

export default async function OpenMicArtistVotingPage({
  params,
}: {
  params: { slug: string; artistSlug: string };
}) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();

  const entries = await getLeaderboard(contest.id);
  const entry = entries.find((e) => slugifyArtist(e.stageName) === params.artistSlug);
  if (!entry) notFound();

  // Compute rank
  const sorted = [...entries].sort((a, b) => b.voteCount - a.voteCount);
  const rank = sorted.findIndex((e) => e.id === entry.id) + 1;
  const totalVotes = entries.reduce((s, e) => s + e.voteCount, 0);

  // Nearby entries for "also vote for" section
  const others = sorted.filter((e) => e.id !== entry.id).slice(0, 3);

  return (
    <section
      style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', minHeight: '80vh', paddingTop: 0 }}
    >
      {/* Contest banner */}
      <div style={{ background: 'linear-gradient(90deg,#f59e0b,#d97706)', padding: '8px 24px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#000' }}>
          🎤 {contest.title} — Voting is LIVE
        </p>
      </div>

      <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6">

            {/* Main voting card */}
            <OpenMicArtistVotingCard
              contestId={contest.id}
              contestSlug={contest.slug}
              entry={{
                id: entry.id,
                stageName: entry.stageName,
                songTitle: entry.songTitle,
                songUrl: entry.songUrl,
                voteCount: entry.voteCount,
                status: entry.status,
              }}
              rank={rank}
              totalVotes={totalVotes}
              votePriceNgn={contest.votingConfig.votePrice}
              freeVoting={contest.votingConfig.freeVoting}
              paidVoting={contest.votingConfig.paidVoting}
            />

            {/* Back to leaderboard */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <Link
                href={`/open-mic/${contest.slug}/entries`}
                style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, textDecoration: 'none' }}
              >
                ← View all entries &amp; leaderboard
              </Link>
            </div>
          </div>

          {/* Others to vote for */}
          {others.length > 0 && (
            <div className="col-12 mt-5">
              <h5 style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: 13, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
                Also support these artists
              </h5>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                {others.map((o, i) => (
                  <Link
                    key={o.id}
                    href={`/open-mic/${contest.slug}/entry/${slugifyArtist(o.stageName)}`}
                    style={{
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12, padding: '12px 20px', textDecoration: 'none',
                      display: 'flex', alignItems: 'center', gap: 10, minWidth: 180,
                    }}
                  >
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: i === 0 ? '#f59e0b' : 'rgba(255,255,255,0.1)',
                      color: i === 0 ? '#000' : 'rgba(255,255,255,0.5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 11, flexShrink: 0,
                    }}>#{i + 1}</span>
                    <div>
                      <p style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, marginBottom: 1 }}>{o.stageName}</p>
                      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 0 }}>{o.voteCount.toLocaleString()} votes</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
