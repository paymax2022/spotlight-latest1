'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { listStemContests, listStemLeaderboard } from '@/services/stemService';
import type { StemContest, StemLeaderboardEntry } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Leaderboard" subtitle="Ranking view based on configured formula and score components." />
      <StemModuleLinks />
      <select value={contestId} onChange={(e) => setContestId(e.target.value)} style={{ marginTop: 8 }}>
        <option value="">Select contest</option>
        {contests.map((c) => (
          <option key={c.id || c.slug} value={c.id}>{c.name}</option>
        ))}
      </select>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <Card key={r.id || `${r.contestId}-${r.participantId}`}>
            <p style={{ margin: 0, fontWeight: 700 }}>#{r.rankPosition || '-'} {r.displayName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>
              Final: {r.finalScore} (Judge {r.judgeScore} · Vote {r.voteScore} · Stage {r.stageScore})
            </p>
          </Card>
        ))}
        {!contestId ? <p style={{ color: colors.muted }}>Select a contest to view leaderboard.</p> : null}
        {contestId && rows.length === 0 ? <p style={{ color: colors.muted }}>No leaderboard entries yet.</p> : null}
      </div>
    </Page>
  );
}
