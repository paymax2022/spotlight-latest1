'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCompetitionOverview } from '@/services/competitionsService';
import type { CompetitionOverview } from '@/types/competitions';
import { Page, PageHeader, colors } from '@/components/ui/vuexy';

export default function AdminCompetitionsPage() {
  const [data, setData] = useState<CompetitionOverview | null>(null);
  useEffect(() => { void getCompetitionOverview().then(setData); }, []);

  return (
    <Page>
      <PageHeader title="Competitions Overview" />
      {!data ? <p style={{ color: colors.muted }}>Loading...</p> : (
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
    </Page>
  );
}
