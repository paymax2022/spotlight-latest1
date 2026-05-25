'use client';

import { useEffect, useMemo, useState } from 'react';

type Contest = { id: string; title: string; month: number; year: number; finalistsTarget: number; finalePlaylistLocked?: boolean };
type Submission = { id: string; songTitle: string; stageName: string; status: string; voteCount: number };
type PlaylistItem = {
  order: number;
  submissionId: string;
  stageName: string;
  songTitle: string;
  status: string;
  djCueNote?: string;
  played?: boolean;
  playedAt?: string;
  judgeScore?: number;
  audienceReactionScore?: number;
};

export default function OpenMicFinaleManager() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [contestId, setContestId] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [winnerSubmissionId, setWinnerSubmissionId] = useState('');
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadContests() {
    const res = await fetch('/api/admin/open-mic/contests', { headers: { 'x-spotlight-role': 'admin' }, cache: 'no-store' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load contests');
    const rows = (payload.contests || []) as Contest[];
    setContests(rows);
    if (!contestId && rows[0]) setContestId(rows[0].id);
  }

  async function loadContestData(targetContestId: string) {
    const [subsRes, playlistRes] = await Promise.all([
      fetch(`/api/admin/open-mic/submissions?contestId=${targetContestId}`, { headers: { 'x-spotlight-role': 'admin' }, cache: 'no-store' }),
      fetch(`/api/admin/open-mic/contests/${targetContestId}/playlist`, { headers: { 'x-spotlight-role': 'admin' }, cache: 'no-store' }),
    ]);
    const [subsPayload, playlistPayload] = await Promise.all([subsRes.json().catch(() => ({})), playlistRes.json().catch(() => ({}))]);
    if (!subsRes.ok || !subsPayload?.success) throw new Error(subsPayload?.error || 'Failed to load submissions');
    if (!playlistRes.ok || !playlistPayload?.success) throw new Error(playlistPayload?.error || 'Failed to load playlist');
    setSubmissions((subsPayload.submissions || []) as Submission[]);
    setPlaylist((playlistPayload.playlist || []) as PlaylistItem[]);
    const currentContest = contests.find((c) => c.id === targetContestId);
    setLocked(currentContest?.finalePlaylistLocked === true);
  }

  useEffect(() => {
    void loadContests().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load contests'));
  }, []);

  useEffect(() => {
    if (!contestId) return;
    void loadContestData(contestId).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load finale data'));
  }, [contestId]);

  async function runAction(action: 'finalists' | 'autoplaylist' | 'saveplaylist' | 'winner' | 'locktoggle') {
    if (!contestId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'finalists') {
        const res = await fetch(`/api/admin/open-mic/contests/${contestId}/finalists`, { method: 'POST', headers: { 'x-spotlight-role': 'admin' } });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to generate finalists');
        setMessage('Top finalists generated.');
      }
      if (action === 'autoplaylist') {
        const res = await fetch(`/api/admin/open-mic/contests/${contestId}/playlist/autobuild`, { method: 'POST', headers: { 'x-spotlight-role': 'admin' } });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to auto build playlist');
        setMessage('Finale playlist auto-built from finalists.');
      }
      if (action === 'saveplaylist') {
        const res = await fetch(`/api/admin/open-mic/contests/${contestId}/playlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
          body: JSON.stringify({ entries: playlist.map((item, idx) => ({ submissionId: item.submissionId, order: idx + 1 })) }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to save playlist');
        setMessage('Finale playlist order saved.');
      }
      if (action === 'locktoggle') {
        const res = await fetch(`/api/admin/open-mic/contests/${contestId}/playlist/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
          body: JSON.stringify({ locked: !locked }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to toggle lock');
        setLocked(!locked);
        setMessage(!locked ? 'Finale playlist locked.' : 'Finale playlist unlocked.');
      }
      if (action === 'winner') {
        if (!winnerSubmissionId) throw new Error('Select a winner first.');
        const res = await fetch(`/api/admin/open-mic/contests/${contestId}/winner`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
          body: JSON.stringify({ submissionId: winnerSubmissionId }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to announce winner');
        setMessage('Winner announced successfully.');
      }
      await loadContestData(contestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function patchPlaybackItem(submissionId: string, patch: Partial<PlaylistItem>) {
    if (!contestId) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/open-mic/contests/${contestId}/playlist/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
        body: JSON.stringify({
          played: patch.played,
          djCueNote: patch.djCueNote,
          judgeScore: patch.judgeScore,
          audienceReactionScore: patch.audienceReactionScore,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to update playback item');
      await loadContestData(contestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update playback item');
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const next = [...playlist];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setPlaylist(next.map((row, idx) => ({ ...row, order: idx + 1 })));
  }

  const finalists = useMemo(() => submissions.filter((s) => s.status === 'finalist' || s.status === 'winner'), [submissions]);

  return (
    <div>
      {error ? <p className="text-red-400 font-semibold mb-3">{error}</p> : null}
      {message ? <p className="text-emerald-400 font-semibold mb-3">{message}</p> : null}

      <div className="form-shell mb-4">
        <p className="form-section-title">Finale Context</p>
        <label className="form-label">Contest Edition</label>
        <select className="form-input h-[44px]" value={contestId} onChange={(e) => setContestId(e.target.value)}>
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>{contest.title} ({contest.month}/{contest.year})</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={busy || !contestId} onClick={() => void runAction('finalists')}>Generate Top Finalists</button>
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={busy || !contestId} onClick={() => void runAction('autoplaylist')}>Auto-Build Finale Playlist</button>
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={busy || playlist.length === 0 || locked} onClick={() => void runAction('saveplaylist')}>Save Playlist Order</button>
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={busy || !contestId} onClick={() => void runAction('locktoggle')}>{locked ? 'Unlock Playlist' : 'Lock Playlist'}</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 glass-card rounded-md p-4">
          <h5 className="font-display text-foreground mb-3">Finale Playback Order</h5>
          {playlist.length === 0 ? <p className="text-foreground-muted text-sm">No playlist generated yet.</p> : null}
          {playlist.map((item, idx) => (
            <div key={item.submissionId} className="mb-3 border border-border rounded-sm p-3 bg-bg-card">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-foreground-muted">
                  <strong className="text-foreground">#{idx + 1}</strong> {item.songTitle} - {item.stageName}
                  {item.played ? <span className="ml-2 text-emerald-400">Played</span> : <span className="ml-2 text-foreground-dim">Pending</span>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" disabled={locked} onClick={() => moveItem(idx, -1)}>Up</button>
                  <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" disabled={locked} onClick={() => moveItem(idx, 1)}>Down</button>
                </div>
              </div>

              <div className="mt-2">
                <input
                  className="form-input h-[42px] mb-2"
                  placeholder="DJ cue note"
                  value={item.djCueNote || ''}
                  onChange={(e) => {
                    const next = [...playlist];
                    next[idx] = { ...next[idx], djCueNote: e.target.value };
                    setPlaylist(next);
                  }}
                  onBlur={() => void patchPlaybackItem(item.submissionId, { djCueNote: playlist[idx]?.djCueNote || '' })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className="form-input h-[42px]"
                    placeholder="Judge score"
                    value={item.judgeScore ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                      const next = [...playlist];
                      next[idx] = { ...next[idx], judgeScore: val };
                      setPlaylist(next);
                    }}
                    onBlur={() => void patchPlaybackItem(item.submissionId, { judgeScore: playlist[idx]?.judgeScore })}
                  />
                  <input
                    type="number"
                    className="form-input h-[42px]"
                    placeholder="Audience reaction"
                    value={item.audienceReactionScore ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                      const next = [...playlist];
                      next[idx] = { ...next[idx], audienceReactionScore: val };
                      setPlaylist(next);
                    }}
                    onBlur={() => void patchPlaybackItem(item.submissionId, { audienceReactionScore: playlist[idx]?.audienceReactionScore })}
                  />
                </div>
                <button
                  type="button"
                  className="btn-outline py-1.5 px-2 text-[10px] mt-2"
                  onClick={() => void patchPlaybackItem(item.submissionId, { played: !item.played })}
                >
                  {item.played ? 'Mark Unplayed' : 'Mark Played'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-5 glass-card rounded-md p-4">
          <h5 className="font-display text-foreground mb-1">Finalists and Winner</h5>
          <p className="text-sm text-foreground-muted mb-3">Select monthly winner from finalist pool.</p>
          <select className="form-input h-[44px] mb-3" value={winnerSubmissionId} onChange={(e) => setWinnerSubmissionId(e.target.value)}>
            <option value="">Select winner...</option>
            {finalists.map((item) => (
              <option key={item.id} value={item.id}>{item.songTitle} - {item.stageName}</option>
            ))}
          </select>
          <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy || !winnerSubmissionId} onClick={() => void runAction('winner')}>
            Announce Monthly Winner
          </button>
        </div>
      </div>
    </div>
  );
}
