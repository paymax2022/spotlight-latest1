'use client';

import { useMemo, useState } from 'react';

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

export default function OpenMicEntriesBoard({
  contestId,
  contestSlug,
  entries,
  votePriceNgn,
  paidVoting,
  freeVoting,
}: Props) {
  const [votesByEntry, setVotesByEntry] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => `${entry.stageName} ${entry.songTitle}`.toLowerCase().includes(q));
  }, [entries, search]);

  async function vote(submissionId: string, voteType: 'free' | 'paid') {
    const votes = Math.max(1, Number(votesByEntry[submissionId] || 1));
    setBusyId(submissionId);
    setMsg('');
    try {
      const res = await fetch('/api/open-mic/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestId,
          submissionId,
          source: voteType,
          votes,
          amountPaid: voteType === 'paid' ? votes * votePriceNgn : 0,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Vote failed.');
      }
      setMsg('Vote submitted successfully.');
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Vote failed.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-md p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="text-sm text-foreground/70">Public Voting Board • Share your entry and mobilize fans.</div>
        <input
          className="form-input max-w-xs"
          placeholder="Search artist or song"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {msg ? <p className="text-sm text-foreground">{msg}</p> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((entry) => (
          <article key={entry.id} className="glass-card rounded-md p-4">
            <p className="text-xs text-foreground/60 mb-1">{contestSlug}</p>
            <h3 className="text-foreground font-semibold">{entry.songTitle}</h3>
            <p className="text-sm text-foreground/70 mb-2">by {entry.stageName}</p>
            <audio controls className="w-100">
              <source src={entry.songUrl} />
            </audio>
            <div className="mt-3 text-sm text-foreground/70">
              Votes: <strong className="text-foreground">{entry.voteCount}</strong>
            </div>
            <div className="mt-3 flex gap-2 items-center">
              <input
                type="number"
                min={1}
                className="form-input w-24"
                value={votesByEntry[entry.id] || 1}
                onChange={(e) => setVotesByEntry((prev) => ({ ...prev, [entry.id]: Number(e.target.value) }))}
              />
              {freeVoting ? (
                <button
                  type="button"
                  className="btn-outline py-2 px-3 text-xs"
                  disabled={busyId === entry.id}
                  onClick={() => void vote(entry.id, 'free')}
                >
                  {busyId === entry.id ? 'Voting...' : 'Free Vote'}
                </button>
              ) : null}
              {paidVoting ? (
                <button
                  type="button"
                  className="btn-primary py-2 px-3 text-xs"
                  disabled={busyId === entry.id}
                  onClick={() => void vote(entry.id, 'paid')}
                >
                  {busyId === entry.id ? 'Processing...' : `Paid Vote (₦${votePriceNgn})`}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
