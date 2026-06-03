import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContestBySlug, getFinalePlaylist } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function OpenMicFinalePage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
  if (!contest) notFound();
  const playlist = await getFinalePlaylist(contest.id);

  const f = contest.finale;

  return (
    <section
      className="section-padding fix"
      style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', minHeight: '80vh' }}
    >
      <div className="container">

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div
          className="rounded-3 p-4 p-md-5 mb-5"
          style={{
            background: 'linear-gradient(135deg,#1a1140 0%,#2d1f6e 100%)',
            border: '1px solid rgba(245,158,11,0.25)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%', background: 'rgba(245,158,11,0.07)', pointerEvents: 'none' }} />
          <span style={{
            display: 'inline-block', background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b',
            fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
          }}>🏟 Monthly Finale</span>
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 'clamp(1.5rem,4vw,2.2rem)', marginBottom: 6 }}>
            {contest.title} — Finale Night
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 520, marginBottom: 0 }}>
            The top artists compete live. Your votes determine who takes the stage.
          </p>
        </div>

        <div className="row g-4">

          {/* Venue details */}
          <div className="col-12 col-md-6">
            <div className="rounded-3 p-4 h-100" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h5 style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 16 }}>📍 Venue & Schedule</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Venue', value: f.venueName || 'TBA' },
                  { label: 'Type', value: f.venueType?.replace(/_/g, ' ') || 'TBA' },
                  { label: 'Address', value: [f.address, f.city, f.state].filter(Boolean).join(', ') || 'TBA' },
                  { label: 'Date', value: f.date || 'TBA' },
                  { label: 'Doors Open', value: f.doorsOpenTime || 'TBA' },
                  { label: 'Show Starts', value: f.showStartTime || 'TBA' },
                  { label: 'Artist Arrival', value: f.artistArrivalTime || 'TBA' },
                  { label: 'Winner Announced', value: f.winnerAnnouncementTime || 'TBA' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 120, paddingTop: 2 }}>{label}</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Running order */}
          <div className="col-12 col-md-6">
            <div className="rounded-3 p-4 h-100" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h5 style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 16 }}>🎤 Finalist Running Order</h5>
              {playlist.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Lineup not published yet.</p>
                </div>
              ) : (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {playlist.map((item, i) => (
                    <li key={`${item.order}-${item.submissionId}`} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 0', borderBottom: i < playlist.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: i === 0 ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                        color: i === 0 ? '#000' : 'rgba(255,255,255,0.5)',
                        fontWeight: 800, fontSize: 12,
                      }}>{item.order}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 1 }}>{item.stageName}</p>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 0 }}>{item.songTitle}</p>
                      </div>
                      {item.played && (
                        <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700, background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: 20 }}>
                          Performed
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="d-flex flex-wrap gap-2 mt-4">
          <Link href={`/open-mic/${contest.slug}/entries`}
            style={{
              background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000',
              fontWeight: 700, fontSize: 13, padding: '10px 24px', borderRadius: 8, textDecoration: 'none',
            }}>
            Vote Now
          </Link>
          <Link href={`/open-mic/${contest.slug}`}
            style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#e2e8f0', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
            }}>
            ← Contest Details
          </Link>
        </div>

      </div>
    </section>
  );
}
