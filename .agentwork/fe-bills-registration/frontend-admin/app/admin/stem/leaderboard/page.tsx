'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { listStemContests, listStemLeaderboard } from '@/services/stemService';
import type { StemContest, StemLeaderboardEntry } from '@/types/stem';

export default function StemLeaderboardPage() {
  const [contests, setContests] = useState<StemContest[]>([]);
  const [contestId, setContestId] = useState('');
  const [rows, setRows] = useState<StemLeaderboardEntry[]>([]);

  useEffect(() => {
    void listStemContests(150).then((data) => {
      setContests(data);
      if (data[0]?.id) setContestId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!contestId) return;
    void listStemLeaderboard(contestId, 150).then(setRows);
  }, [contestId]);

  return (
    <section>
      <h1>STEM Leaderboard</h1>
      <StemModuleLinks />
      <p>Ranking view based on configured formula and score components.</p>
      <select value={contestId} onChange={(e) => setContestId(e.target.value)} style={{ marginTop: 8 }}>
        <option value="">Select contest</option>
        {contests.map((c) => (
          <option key={c.id || c.slug} value={c.id}>{c.name}</option>
        ))}
      </select>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <article key={r.id || `${r.contestId}-${r.participantId}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>#{r.rankPosition || '-'} {r.displayName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
              Final: {r.finalScore} (Judge {r.judgeScore} · Vote {r.voteScore} · Stage {r.stageScore})
            </p>
          </article>
        ))}
        {!contestId ? <p>Select a contest to view leaderboard.</p> : null}
        {contestId && rows.length === 0 ? <p>No leaderboard entries yet.</p> : null}
      </div>
    </section>
  );
}
