'use client';

import { useState, useMemo } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

type LeaderboardEntry = {
  rank: number;
  name: string;
  score: number;
  prizeAmount: number;
  status: 'claimed' | 'pending' | 'forfeited';
};

type CompetitionStats = {
  totalParticipants: number;
  totalPrizePool: number;
  pendingClaims: number;
  leaderboard: LeaderboardEntry[];
};

const MOCK_DATA: Record<string, CompetitionStats> = {
  'open-mic-q3': {
    totalParticipants: 342,
    totalPrizePool: 500000,
    pendingClaims: 2,
    leaderboard: [
      { rank: 1, name: 'Chioma Okonkwo', score: 92, prizeAmount: 150000, status: 'claimed' },
      { rank: 2, name: 'Amara Ejiro', score: 89, prizeAmount: 100000, status: 'pending' },
      { rank: 3, name: 'Tunde Adeyemi', score: 85, prizeAmount: 75000, status: 'claimed' },
      { rank: 4, name: 'Zainab Hassan', score: 81, prizeAmount: 50000, status: 'pending' },
      { rank: 5, name: 'Chidi Nwankwo', score: 78, prizeAmount: 25000, status: 'claimed' },
    ]
  },
  'reality-tv-s2': {
    totalParticipants: 128,
    totalPrizePool: 2000000,
    pendingClaims: 1,
    leaderboard: [
      { rank: 1, name: 'Ada Okafor', score: 95, prizeAmount: 750000, status: 'claimed' },
      { rank: 2, name: 'Emeka Nwosu', score: 88, prizeAmount: 500000, status: 'pending' },
      { rank: 3, name: 'Funmi Adeleke', score: 82, prizeAmount: 300000, status: 'claimed' },
      { rank: 4, name: 'Karim Hassan', score: 79, prizeAmount: 200000, status: 'claimed' },
      { rank: 5, name: 'Zara Okoye', score: 75, prizeAmount: 100000, status: 'claimed' },
    ]
  },
  'multi-skill': {
    totalParticipants: 215,
    totalPrizePool: 750000,
    pendingClaims: 3,
    leaderboard: [
      { rank: 1, name: 'Victor Okoro', score: 91, prizeAmount: 250000, status: 'claimed' },
      { rank: 2, name: 'Blessing Ifukor', score: 87, prizeAmount: 150000, status: 'pending' },
      { rank: 3, name: 'Chukwu Eze', score: 84, prizeAmount: 100000, status: 'pending' },
      { rank: 4, name: 'Linda Opara', score: 80, prizeAmount: 75000, status: 'claimed' },
      { rank: 5, name: 'Segun Adebayo', score: 76, prizeAmount: 50000, status: 'pending' },
    ]
  }
};

export default function ResultsPage() {
  const [selectedCompetition, setSelectedCompetition] = useState('open-mic-q3');
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const competitionData = useMemo(() => MOCK_DATA[selectedCompetition as keyof typeof MOCK_DATA] || MOCK_DATA['open-mic-q3'], [selectedCompetition]);
  const totalPrizeDistributed = competitionData.leaderboard.reduce((sum, e) => sum + e.prizeAmount, 0);

  const handlePublish = () => {
    alert(`Results published for ${Object.entries(MOCK_DATA).find(([k]) => k === selectedCompetition)?.[1] ? 'selected competition' : 'competition'}!`);
  };

  const handleSend = (rank: number) => {
    setSendingId(rank);
    setTimeout(() => {
      alert(`Prize sent to participant at rank ${rank}!`);
      setSendingId(null);
    }, 500);
  };

  return (
    <Page>
      <PageHeader
        title="Results & Leaderboard"
        subtitle="View final standings, manage prize distribution, and publish results."
        actions={<Button variant="primary" onClick={handlePublish}>Publish Results</Button>}
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
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>{competitionData.totalParticipants}</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Prize Pool</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>₦{(competitionData.totalPrizePool / 1000000).toFixed(0)}M</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Distributed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.success }}>₦{(totalPrizeDistributed / 1000000).toFixed(1)}M</div>
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
          <div style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 600 }}>Pending Claims</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.warning }}>{competitionData.pendingClaims}</div>
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
            {competitionData.leaderboard.map((entry) => (
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
                    <Button variant="outline" sm onClick={() => setSelectedEntry(entry)}>Details</Button>
                    {entry.status === 'pending' && <Button variant="primary" sm onClick={() => handleSend(entry.rank)} disabled={sendingId === entry.rank}>{sendingId === entry.rank ? 'Sending...' : 'Send'}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Entry Details Modal */}
      {selectedEntry && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <Card style={{ maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: colors.text }}>Participant Details</h2>
              <button
                onClick={() => setSelectedEntry(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: colors.muted,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: colors.muted }}>Rank:</span> <strong>#{selectedEntry.rank}</strong></div>
              <div><span style={{ color: colors.muted }}>Name:</span> <strong>{selectedEntry.name}</strong></div>
              <div><span style={{ color: colors.muted }}>Score:</span> <strong>{selectedEntry.score}%</strong></div>
              <div><span style={{ color: colors.muted }}>Prize Amount:</span> <strong>₦{(selectedEntry.prizeAmount / 1000).toFixed(0)}K</strong></div>
              <div><span style={{ color: colors.muted }}>Claim Status:</span>
                <Badge
                  text={selectedEntry.status === 'claimed' ? 'Claimed' : selectedEntry.status === 'pending' ? 'Pending Claim' : 'Forfeited'}
                  color={selectedEntry.status === 'claimed' ? colors.success : selectedEntry.status === 'pending' ? colors.warning : colors.danger}
                />
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <Button variant="outline" onClick={() => setSelectedEntry(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
