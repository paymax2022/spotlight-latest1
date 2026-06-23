'use client';

import { useRef, useState, useEffect } from 'react';
import OpenMicVoteModal from './OpenMicVoteModal';

interface Entry {
  id: string;
  stageName: string;
  songTitle: string;
  songUrl: string;
  voteCount: number;
  status: string;
}

interface Props {
  contestId: string;
  contestSlug: string;
  entry: Entry;
  rank: number;
  totalVotes: number;
  votePriceNgn: number;
  freeVoting: boolean;
  paidVoting: boolean;
}

const RANK_COLOR = ['#f59e0b', '#94a3b8', '#cd7f32'];
const RANK_EMOJI = ['🥇', '🥈', '🥉'];

function fmt(s: number) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function SharePanel({ stageName, songTitle, url }: { stageName: string; songTitle: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const full = typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;

  function share(channel: 'copy' | 'whatsapp' | 'twitter') {
    const text = `Vote for ${stageName} — "${songTitle}" on Spotlight Open Mic!`;
    if (channel === 'copy') {
      void navigator.clipboard.writeText(full).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
    } else if (channel === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${full}`)}`);
    } else {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(full)}`);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, textAlign: 'center' }}>
        Share &amp; get more votes
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => share('whatsapp')} style={shareBtnStyle('#25d366')}>WhatsApp</button>
        <button onClick={() => share('twitter')} style={shareBtnStyle('#1da1f2')}>Twitter/X</button>
        <button onClick={() => share('copy')} style={shareBtnStyle('rgba(255,255,255,0.12)')}>
          {copied ? '✓ Copied' : '🔗 Copy link'}
        </button>
      </div>
    </div>
  );
}

function shareBtnStyle(bg: string): React.CSSProperties {
  return {
    flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none',
    background: bg, color: bg === 'rgba(255,255,255,0.12)' ? 'rgba(255,255,255,0.7)' : '#fff',
    fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'opacity 0.2s',
  };
}

export default function OpenMicArtistVotingCard({
  contestId, contestSlug, entry, rank: initialRank, totalVotes: initialTotal, votePriceNgn, freeVoting, paidVoting,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveVoteCount, setLiveVoteCount] = useState(entry.voteCount);
  const [liveTotalVotes, setLiveTotalVotes] = useState(initialTotal);
  const [rank, setRank] = useState(initialRank);
  const [showModal, setShowModal] = useState(false);

  // Subscribe to the contest SSE stream for real-time counts
  useEffect(() => {
    const es = new EventSource(`/api/open-mic/votes/stream?contestId=${encodeURIComponent(contestId)}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; entries: { id: string; voteCount: number }[] };
        if (msg.type === 'snapshot' && Array.isArray(msg.entries)) {
          const me = msg.entries.find((r) => r.id === entry.id);
          if (me) setLiveVoteCount(me.voteCount);
          const total = msg.entries.reduce((s, r) => s + r.voteCount, 0);
          setLiveTotalVotes(total);
          // Recompute rank from live data
          const sorted = [...msg.entries].sort((a, b) => b.voteCount - a.voteCount);
          const newRank = sorted.findIndex((r) => r.id === entry.id) + 1;
          if (newRank > 0) setRank(newRank);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [contestId, entry.id]);

  const pct = liveTotalVotes > 0 ? Math.round((liveVoteCount / liveTotalVotes) * 100) : 0;
  const isTop3 = rank <= 3;
  const artistUrl = `/open-mic/${contestSlug}/entry/${entry.stageName.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')}`;

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { void el.play(); setPlaying(true); }
  }

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  return (
    <>
      <div style={{
        background: 'linear-gradient(160deg,rgba(20,16,43,0.95) 0%,rgba(15,13,26,0.98) 100%)',
        border: `1.5px solid ${isTop3 ? RANK_COLOR[Math.min(rank - 1, 2)] + '55' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>

        {/* Rank banner */}
        <div style={{
          background: isTop3
            ? `linear-gradient(90deg,${RANK_COLOR[Math.min(rank - 1, 2)]}22,transparent)`
            : 'rgba(255,255,255,0.02)',
          padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          {isTop3 && <span style={{ fontSize: 22 }}>{RANK_EMOJI[rank - 1]}</span>}
          <span style={{
            fontWeight: 800, fontSize: 12, padding: '3px 10px', borderRadius: 20,
            background: isTop3 ? RANK_COLOR[Math.min(rank - 1, 2)] : 'rgba(255,255,255,0.08)',
            color: rank === 1 ? '#000' : rank <= 3 ? '#fff' : 'rgba(255,255,255,0.5)',
          }}>Rank #{rank}</span>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
            {pct}% of all votes
          </span>
        </div>

        {/* Artist info */}
        <div style={{ padding: '28px 24px 0' }}>
          <p style={{ fontSize: 11, color: 'rgba(245,158,11,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Artist</p>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.8rem,5vw,2.4rem)', marginBottom: 4, lineHeight: 1.1 }}>
            {entry.stageName}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, marginBottom: 0 }}>🎵 {entry.songTitle}</p>
        </div>

        {/* Audio player */}
        <div style={{ padding: '20px 24px' }}>
          <audio
            ref={audioRef}
            src={entry.songUrl}
            onTimeUpdate={() => { const el = audioRef.current; if (el?.duration) setProgress(el.currentTime / el.duration); }}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onEnded={() => setPlaying(false)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={togglePlay}
              style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0, border: 'none',
                background: playing ? 'rgba(245,158,11,0.15)' : 'linear-gradient(135deg,#f59e0b,#d97706)',
                color: playing ? '#f59e0b' : '#000',
                fontSize: playing ? 18 : 20, cursor: 'pointer', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: playing ? 'none' : '0 4px 16px rgba(245,158,11,0.35)',
              }}
            >{playing ? '⏸' : '▶'}</button>
            <div style={{ flex: 1 }}>
              <div
                style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}
                onClick={(e) => {
                  const el = audioRef.current;
                  if (!el?.duration) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  el.currentTime = ((e.clientX - r.left) / r.width) * el.duration;
                }}
              >
                <div style={{ height: '100%', width: `${progress * 100}%`, background: 'linear-gradient(90deg,#f59e0b,#d97706)', borderRadius: 4, transition: 'width 0.15s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{fmt(progress * duration)}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{fmt(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Vote count */}
        <div style={{ margin: '0 24px', padding: '16px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 0 }}>Total Votes</p>
            <p style={{ fontSize: 24, color: '#f59e0b', fontWeight: 900, marginBottom: 0, lineHeight: 1 }}>
              {liveVoteCount.toLocaleString()}
            </p>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: `linear-gradient(90deg,${isTop3 ? RANK_COLOR[Math.min(rank - 1, 2)] : '#6366f1'},${isTop3 ? RANK_COLOR[Math.min(rank - 1, 2)] + '88' : '#818cf8'})`,
              borderRadius: 6, transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        {/* Vote button */}
        <div style={{ padding: '20px 24px' }}>
          {(freeVoting || paidVoting) ? (
            <button
              onClick={() => setShowModal(true)}
              style={{
                width: '100%', padding: '16px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg,#f59e0b 0%,#d97706 100%)',
                color: '#000', fontWeight: 900, fontSize: 17, cursor: 'pointer',
                boxShadow: '0 8px 32px rgba(245,158,11,0.4)',
                transition: 'all 0.2s',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(245,158,11,0.5)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(245,158,11,0.4)'; }}
            >
              👍 Vote for {entry.stageName}
            </button>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 0 }}>Voting is not currently active for this contest.</p>
            </div>
          )}
        </div>

        {/* Share panel */}
        <div style={{ padding: '0 24px 24px' }}>
          <SharePanel stageName={entry.stageName} songTitle={entry.songTitle} url={artistUrl} />
        </div>
      </div>

      {showModal && (
        <OpenMicVoteModal
          contestId={contestId}
          submissionId={entry.id}
          stageName={entry.stageName}
          songTitle={entry.songTitle}
          votePriceNgn={votePriceNgn}
          freeVoting={freeVoting}
          paidVoting={paidVoting}
          onClose={() => setShowModal(false)}
          onSuccess={(newCount) => { if (newCount) setLiveVoteCount(newCount); else setLiveVoteCount((v) => v + 1); }}
        />
      )}
    </>
  );
}
