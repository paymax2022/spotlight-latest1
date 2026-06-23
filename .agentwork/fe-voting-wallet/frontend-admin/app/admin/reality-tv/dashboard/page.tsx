'use client';

import { useEffect, useState } from 'react';
import { getRealityTVDashboard } from '@/services/realityTvService';
import type { RealityTVDashboardMetrics } from '@/types/realityTv';

export default function RealityTVAdminDashboardPage() {
  const [metrics, setMetrics] = useState<RealityTVDashboardMetrics | null>(null);

  useEffect(() => {
    void getRealityTVDashboard().then(setMetrics);
  }, []);

  const cards = [
    { label: 'Total Seasons', value: metrics?.totalSeasons ?? 0 },
    { label: 'Applications', value: metrics?.totalApplications ?? 0 },
    { label: 'Pending Review', value: metrics?.pendingApplications ?? 0 },
    { label: 'Reality Contestants', value: metrics?.totalContestants ?? 0 },
    { label: 'Active Voting Rounds', value: metrics?.activeVotingRounds ?? 0 },
    { label: 'Total Votes', value: metrics?.totalVotes ?? 0 },
    { label: 'Paid Votes', value: metrics?.paidVotes ?? 0 },
    { label: 'Free Votes', value: metrics?.freeVotes ?? 0 },
    { label: 'Open Support Tickets', value: metrics?.openTickets ?? 0 },
  ];

  return (
    <section>
      <h1>Reality TV Command Center</h1>
      {metrics?.activeSeason ? (
        <div style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 12 }}>Active Season</p>
          <p style={{ margin: '6px 0 0 0', fontWeight: 600 }}>
            {metrics.activeSeason.season_title} (S{metrics.activeSeason.season_number})
          </p>
          <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>Status: {metrics.activeSeason.status}</p>
        </div>
      ) : null}

      {!metrics ? <p style={{ marginTop: 12 }}>Loading dashboard...</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 12, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {cards.map((card) => (
          <article key={card.label} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{card.label}</p>
            <p style={{ margin: '6px 0 0 0', fontWeight: 700, fontSize: 22 }}>{card.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
