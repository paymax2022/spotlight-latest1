'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCompetitionOverview } from '@/services/competitionsService';
import type { CompetitionOverview } from '@/types/competitions';

export default function AdminCompetitionsPage() {
  const [data, setData] = useState<CompetitionOverview | null>(null);
  useEffect(() => { void getCompetitionOverview().then(setData); }, []);

  return (
    <div>
      <h1>Competitions Overview</h1>
      {!data ? <p>Loading...</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          <p>Total: {data.totalContests}</p>
          <p>Reality TV: {data.realityTvContests}</p>
          <p>Open Mic: {data.openMicContests}</p>
          <p>Multi Skill: {data.multiSkillContests}</p>
          <p style={{ marginTop: 8 }}>
            <Link href="/admin/competitions/open-mic">Open Open Mic Editions</Link>
          </p>
        </div>
      )}
    </div>
  );
}
