import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';
import OpenMicProgressTracker from '@/components/openmic/OpenMicProgressTracker';

export const dynamic = 'force-dynamic';

export default async function OpenMicContestDetailsPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const leaderboard = await getLeaderboard(contest.id);

  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

  return (
    <section
      className="section-padding fix"
      style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', minHeight: '80vh' }}
    >
      <div className="container">

        {/* ── Hero banner ─────────────────────────────────────────────────── */}
        <div
          className="rounded-3 p-4 p-md-5 mb-5"
          style={{
            background: 'linear-gradient(135deg,#1a1140 0%,#2d1f6e 100%)',
            border: '1px solid rgba(245,158,11,0.25)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          {/* Decorative glow */}
          <div style={{
            position: 'absolute', top: -60, right: -60, width: 220, height: 220,
            borderRadius: '50%', background: 'rgba(245,158,11,0.08)', pointerEvents: 'none',
          }} />

          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
            <div>
              <span style={{
                display: 'inline-block', background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b',
                fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
              }}>
                🎤 Open Mic Contest
              </span>
              <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 'clamp(1.6rem,4vw,2.5rem)', marginBottom: 8 }}>
                {contest.title}
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.65)', maxWidth: 560, marginBottom: 0 }}>
                {contest.description || 'Monthly open mic — submit your song, earn votes, reach the finale.'}
              </p>
            </div>
            <div className="d-flex flex-wrap gap-2 mt-2">
              <Link href={`/open-mic/${contest.slug}/apply`}
                className="theme-btn" style={{ fontSize: 13, padding: '10px 24px' }}>
                Apply Now
              </Link>
              <Link href={`/open-mic/${contest.slug}/entries`}
                style={{
                  background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)',
                  color: '#f59e0b', fontWeight: 700, fontSize: 13, padding: '10px 24px',
                  borderRadius: 8, textDecoration: 'none', display: 'inline-block',
                }}>
                Vote Now
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <OpenMicProgressTracker currentStep={1} />
          </div>
        </div>

        <div className="row g-4">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="col-12 col-lg-7">

            {/* Beat section */}
            <div className="rounded-3 p-4 mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h5 style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 12 }}>🎵 Official Beat</h5>
              {contest.beat ? (
                <>
                  <p style={{ color: '#e2e8f0', fontWeight: 600 }}>
                    {contest.beat.beatTitle}{' '}
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, fontSize: 13 }}>
                      by {contest.beat.producerCredit || contest.beat.producerName}
                    </span>
                  </p>
                  {contest.beat.usageRules && (
                    <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 12 }}>{contest.beat.usageRules}</p>
                  )}
                  {contest.beat.previewUrl ? (
                    <audio controls style={{ width: '100%', marginTop: 8 }}>
                      <source src={contest.beat.previewUrl} />
                    </audio>
                  ) : null}
                </>
              ) : (
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 0 }}>Beat not uploaded yet for this edition.</p>
              )}
            </div>

            {/* Contest rules */}
            <div className="rounded-3 p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h5 style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 16 }}>📋 Contest Details</h5>
              <div className="row g-3">
                {[
                  { label: 'Registration Open', value: `${fmt(contest.registrationStartAt)} – ${fmt(contest.registrationEndAt)}` },
                  { label: 'Submission Window', value: `${fmt(contest.submissionStartAt)} – ${fmt(contest.submissionEndAt)}` },
                  { label: 'Selection Model', value: contest.selectionModel.replace(/_/g, ' ') },
                  { label: 'Finalists Target', value: `Top ${contest.finalistsTarget}` },
                  { label: 'Voting Split', value: `${contest.publicVoteWeight}% public / ${contest.judgeWeight}% judges` },
                  { label: 'Finale Venue', value: [contest.finale.venueName, contest.finale.city, contest.finale.state].filter(Boolean).join(', ') || 'TBA' },
                ].map(({ label, value }) => (
                  <div key={label} className="col-12 col-sm-6">
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</p>
                    <p style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 0 }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right column: Top songs leaderboard ─────────────────────── */}
          <div className="col-12 col-lg-5">
            <div className="rounded-3 p-4 h-100" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 0 }}>🏆 Top Songs</h5>
                {leaderboard.length > 0 && (
                  <Link href={`/open-mic/${contest.slug}/entries`}
                    style={{ color: '#f59e0b', fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>
                    View all →
                  </Link>
                )}
              </div>
              {leaderboard.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>🎶</div>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 0 }}>No songs published for voting yet.</p>
                </div>
              ) : (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {leaderboard.slice(0, 8).map((entry, i) => (
                    <li key={entry.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 0', borderBottom: i < Math.min(leaderboard.length, 8) - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800,
                        background: i === 0 ? '#f59e0b' : i === 1 ? 'rgba(255,255,255,0.15)' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.07)',
                        color: i === 0 ? '#000' : i === 1 ? '#e2e8f0' : i === 2 ? '#fff' : 'rgba(255,255,255,0.4)',
                      }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.songTitle}</p>
                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 0 }}>{entry.stageName}</p>
                      </div>
                      <span style={{ color: '#f59e0b', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {entry.voteCount.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <Link href={`/open-mic/${contest.slug}/entries`}
                style={{
                  display: 'block', textAlign: 'center', marginTop: 16,
                  background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000',
                  fontWeight: 700, fontSize: 13, padding: '10px', borderRadius: 8,
                  textDecoration: 'none',
                }}>
                Vote for Your Favourite
              </Link>
            </div>
          </div>
        </div>

        {/* ── Bottom nav ──────────────────────────────────────────────────── */}
        <div className="d-flex flex-wrap gap-2 mt-4">
          <Link href={`/open-mic/${contest.slug}/enter`} className="theme-btn style-2" style={{ fontSize: 13 }}>
            Submit Your Song
          </Link>
          <Link href={`/open-mic/${contest.slug}/finale`}
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 8, textDecoration: 'none' }}>
            Finale Info
          </Link>
          <Link href="/open-mic"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 8, textDecoration: 'none' }}>
            ← All Contests
          </Link>
        </div>

      </div>
    </section>
  );
}
