'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import OpenMicVoteModal from './OpenMicVoteModal';

type Entry = {
  id: string;
  stageName: string;
  songTitle: string;
  songUrl: string;
  voteCount: number;
  status: string;
};

type Props = {
  contestId: string;
  contestSlug: string;
  entries: Entry[];
  votePriceNgn: number;
  paidVoting: boolean;
  freeVoting: boolean;
};

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7f32'];
const RANK_EMOJI  = ['🥇', '🥈', '🥉'];

function slugify(name: string) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/* ── Mini audio preview ──────────────────────────────────────────────────── */
function MiniPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { void el.play(); setPlaying(true); }
  }

  useEffect(() => () => { ref.current?.pause(); }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
      <audio ref={ref} src={url} onEnded={() => setPlaying(false)} />
      <button
        onClick={toggle}
        style={{
          width: 30, height: 30, borderRadius: '50%', border: 'none', flexShrink: 0,
          background: playing ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.15)',
          color: '#f59e0b', fontSize: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >{playing ? '⏸' : '▶'}</button>
      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
        {playing ? 'Playing…' : 'Preview song'}
      </span>
    </div>
  );
}

/* ── Single entry card ───────────────────────────────────────────────────── */
function EntryCard({
  entry, rank, contestSlug, totalVotes, freeVoting, paidVoting,
  onVoteClick,
}: {
  entry: Entry & { localVotes: number };
  rank: number;
  contestSlug: string;
  totalVotes: number;
  freeVoting: boolean;
  paidVoting: boolean;
  onVoteClick: () => void;
}) {
  const liveCount = entry.voteCount + entry.localVotes;
  const pct = totalVotes > 0 ? Math.round((liveCount / totalVotes) * 100) : 0;
  const isTop3 = rank <= 3;

  return (
    <article style={{
      background: isTop3
        ? `linear-gradient(160deg,rgba(${rank === 1 ? '245,158,11' : rank === 2 ? '148,163,184' : '205,127,50'},0.08) 0%,rgba(255,255,255,0.02) 100%)`
        : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isTop3
        ? `rgba(${rank === 1 ? '245,158,11' : rank === 2 ? '148,163,184' : '205,127,50'},0.3)`
        : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 16, padding: '18px 20px',
      transition: 'transform 0.2s, box-shadow 0.2s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(0,0,0,0.3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isTop3 ? RANK_COLORS[rank - 1] : 'rgba(255,255,255,0.07)',
            color: rank === 1 ? '#000' : isTop3 ? '#fff' : 'rgba(255,255,255,0.5)',
            fontWeight: 900, fontSize: isTop3 ? 14 : 11,
          }}>
            {isTop3 ? RANK_EMOJI[rank - 1] : rank}
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ color: '#fff', fontWeight: 800, fontSize: 15, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.stageName}
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🎵 {entry.songTitle}
            </p>
          </div>
        </div>

        {/* Live vote count */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ color: '#f59e0b', fontWeight: 900, fontSize: 20, marginBottom: 0, lineHeight: 1 }}>
            {liveCount.toLocaleString()}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 0 }}>{pct}% of votes</p>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 12, height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: isTop3
            ? `linear-gradient(90deg,${RANK_COLORS[rank - 1]},${RANK_COLORS[rank - 1]}88)`
            : 'linear-gradient(90deg,#6366f1,#818cf8)',
          borderRadius: 4, transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Audio preview */}
      {entry.songUrl && <MiniPlayer url={entry.songUrl} />}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {(freeVoting || paidVoting) && (
          <button
            onClick={onVoteClick}
            style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg,#f59e0b,#d97706)',
              color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(245,158,11,0.35)',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
          >
            👍 Vote
          </button>
        )}
        <Link
          href={`/open-mic/${contestSlug}/entry/${slugify(entry.stageName)}`}
          style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600,
            textDecoration: 'none', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center',
          }}
        >
          Details
        </Link>
      </div>
    </article>
  );
}

/* ── Main board ──────────────────────────────────────────────────────────── */
export default function OpenMicEntriesBoard({
  contestId, contestSlug, entries, votePriceNgn, paidVoting, freeVoting,
}: Props) {
  const [search, setSearch]     = useState('');
  const [sort, setSort]         = useState<'votes' | 'name'>('votes');
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [voteTarget, setVoteTarget] = useState<Entry | null>(null);

  // SSE — subscribe to real-time vote count updates
  useEffect(() => {
    const es = new EventSource(`/api/open-mic/votes/stream?contestId=${encodeURIComponent(contestId)}`);

    es.onopen = () => setLiveStatus('live');

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          entries: { id: string; voteCount: number }[];
        };
        if (msg.type === 'snapshot' && Array.isArray(msg.entries)) {
          setLiveCounts((prev) => {
            const next = { ...prev };
            for (const row of msg.entries) next[row.id] = row.voteCount;
            return next;
          });
          setLiveStatus('live');
        }
      } catch { /* ignore malformed frames */ }
    };

    es.onerror = () => setLiveStatus('error');

    return () => es.close();
  }, [contestId]);

  const enriched = useMemo(
    () => entries.map((e) => ({
      ...e,
      localVotes: 0,
      voteCount: liveCounts[e.id] ?? e.voteCount,
    })),
    [entries, liveCounts],
  );

  const totalVotes = useMemo(
    () => enriched.reduce((s, e) => s + e.voteCount, 0),
    [enriched],
  );

  const sorted = useMemo(() => {
    const base = [...enriched].sort((a, b) =>
      sort === 'votes'
        ? b.voteCount - a.voteCount
        : a.stageName.localeCompare(b.stageName),
    );
    const q = search.trim().toLowerCase();
    return q ? base.filter((e) => `${e.stageName} ${e.songTitle}`.toLowerCase().includes(q)) : base;
  }, [enriched, sort, search]);

  function handleVoteSuccess(submissionId: string, newCount?: number) {
    // Optimistically bump while SSE catches up (usually < 4 s)
    if (newCount) {
      setLiveCounts((prev) => ({ ...prev, [submissionId]: newCount }));
    } else {
      setLiveCounts((prev) => ({ ...prev, [submissionId]: (prev[submissionId] ?? 0) + 1 }));
    }
    setVoteTarget(null);
  }

  return (
    <div>
      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 24,
        padding: '16px 20px', borderRadius: 12,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
        alignItems: 'center',
      }}>
        {[
          { label: 'Total Entries',  value: entries.length },
          { label: 'Votes Cast',     value: totalVotes.toLocaleString() },
          { label: 'Leading Artist', value: sorted[0]?.stageName || '—' },
          { label: 'Voting',         value: freeVoting && paidVoting ? 'Free & Paid' : freeVoting ? 'Free' : 'Paid' },
        ].map(({ label, value }) => (
          <div key={label}>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{label}</p>
            <p style={{ color: '#f59e0b', fontWeight: 800, fontSize: 16, marginBottom: 0 }}>{value}</p>
          </div>
        ))}
        {/* Live indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: liveStatus === 'live' ? '#10b981' : liveStatus === 'error' ? '#ef4444' : '#f59e0b',
            boxShadow: liveStatus === 'live' ? '0 0 6px #10b981' : 'none',
            animation: liveStatus === 'connecting' ? 'pulse 1.2s infinite' : 'none',
          }} />
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
            {liveStatus === 'live' ? 'LIVE' : liveStatus === 'error' ? 'Offline' : 'Connecting…'}
          </span>
        </div>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artist or song…"
            style={{
              width: '100%', height: 40, paddingLeft: 36, paddingRight: 12, boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, color: '#fff', fontSize: 13, outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['votes', 'name'] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} style={{
              height: 40, padding: '0 16px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', border: 'none', transition: 'all 0.2s',
              background: sort === s ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.06)',
              color: sort === s ? '#000' : 'rgba(255,255,255,0.5)',
            }}>
              {s === 'votes' ? '🏆 Top Votes' : '🔤 A–Z'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎶</div>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>
            {search ? 'No entries match your search.' : 'No entries published for voting yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {sorted.map((entry, i) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              rank={i + 1}
              contestSlug={contestSlug}
              totalVotes={totalVotes}
              freeVoting={freeVoting}
              paidVoting={paidVoting}
              onVoteClick={() => setVoteTarget(entry)}
            />
          ))}
        </div>
      )}

      {/* ── Vote modal ─────────────────────────────────────────────────── */}
      {voteTarget && (
        <OpenMicVoteModal
          contestId={contestId}
          submissionId={voteTarget.id}
          stageName={voteTarget.stageName}
          songTitle={voteTarget.songTitle}
          votePriceNgn={votePriceNgn}
          freeVoting={freeVoting}
          paidVoting={paidVoting}
          onClose={() => setVoteTarget(null)}
          onSuccess={(newCount) => handleVoteSuccess(voteTarget.id, newCount)}
        />
      )}
    </div>
  );
}
