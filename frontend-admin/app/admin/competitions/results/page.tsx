'use client';

import { useState } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

type LeaderboardEntry = {
  rank: number;
  name: string;
  score: number;
  prizeAmount: number;
  status: 'claimed' | 'pending' | 'forfeited';
};

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: 'Chioma Okonkwo', score: 92, prizeAmount: 150000, status: 'claimed' },
  { rank: 2, name: 'Amara Ejiro', score: 89, prizeAmount: 100000, status: 'pending' },
  { rank: 3, name: 'Tunde Adeyemi', score: 85, prizeAmount: 75000, status: 'claimed' },
  { rank: 4, name: 'Zainab Hassan', score: 81, prizeAmount: 50000, status: 'pending' },
  { rank: 5, name: 'Chidi Nwankwo', score: 78, prizeAmount: 25000, status: 'claimed' },
];

export default function ResultsPage() {
  const [selectedCompetition, setSelectedCompetition] = useState('open-mic-q3');
  const totalPrizeDistributed = MOCK_LEADERBOARD.reduce((sum, e) => sum + e.prizeAmount, 0);

  return (
    <Page>
      <PageHeader
        title="Results & Leaderboard"
        subtitle="View final standings, manage prize distribution, and publish results."
        actions={<Button variant="primary">Publish Results</Button>}
      />

      {/* Competition Selector */}
      <Card title="Select Competition" style={{ marginBottom: 16 }}>
        <select
          value={selectedCompetition}
          onChange={(e) => setSelectedCompetition(e.target.value)}
          style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text, width: '100%', maxWidth: 300
          }}
        >
          <option value="open-mic-q3">Open Mic Q3 2024</option>
          <option value="reality-tv-s2">Reality TV Season 2</option>
          <option value="multi-skill">Multi-Skill Challenge</option>
        </select>
      </Card>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Participants</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>342</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Prize Pool</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>₦500M</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Distributed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.success }}>₦{(totalPrizeDistributed / 1000000).toFixed(1)}M</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Pending Claims</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.warning }}>2</div>
        </div>
      </div>

      {/* Leaderboard */}
      <Card title="Final Standings" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Rank</th>
              <th style={thCell}>Participant</th>
              <th style={thCell}>Score</th>
              <th style={thCell}>Prize Amount</th>
              <th style={thCell}>Claim Status</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_LEADERBOARD.map((entry) => (
              <tr key={entry.rank} style={{ background: entry.rank === 1 ? tint(colors.warning, 0.06) : 'transparent' }}>
                <td style={tdCell}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 700, color: colors.primary }}>#{entry.rank}</span>
                </td>
                <td style={tdCell}><strong>{entry.name}</strong></td>
                <td style={tdCell}>{entry.score}%</td>
                <td style={tdCell}>₦{(entry.prizeAmount / 1000).toFixed(0)}K</td>
                <td style={tdCell}>
                  <Badge
                    text={entry.status === 'claimed' ? 'Claimed' : entry.status === 'pending' ? 'Pending Claim' : 'Forfeited'}
                    color={entry.status === 'claimed' ? colors.success : entry.status === 'pending' ? colors.warning : colors.danger}
                  />
                </td>
                <td style={tdCell}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="outline" sm>Details</Button>
                    {entry.status === 'pending' && <Button variant="primary" sm>Send</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
