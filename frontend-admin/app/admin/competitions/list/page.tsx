'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

type Benefit = {
  id: string;
  name: string;
  type: 'cash' | 'non-cash';
  description: string;
};

type Award = {
  position: number;
  title: string;
  amount?: number;
  benefits: Benefit[];
};

type Competition = {
  id: string;
  title: string;
  type: 'open-mic' | 'reality-tv' | 'multi-skill' | 'other';
  status: 'draft' | 'upcoming' | 'active' | 'ended';
  startDate: string;
  endDate: string;
  participantCount: number;
  totalPrizePool: number;
  banner?: string;
  awards?: Award[];
};

// Mock data - replace with API call
const MOCK_COMPETITIONS: Competition[] = [
  { id: '1', title: 'Open Mic Q3 2024', type: 'open-mic', status: 'active', startDate: '2024-07-01', endDate: '2024-09-30', participantCount: 342, totalPrizePool: 500000 },
  { id: '2', title: 'Reality TV Season 2', type: 'reality-tv', status: 'active', startDate: '2024-06-15', endDate: '2024-10-15', participantCount: 128, totalPrizePool: 2000000 },
  { id: '3', title: 'Multi-Skill Challenge', type: 'multi-skill', status: 'upcoming', startDate: '2024-09-01', endDate: '2024-11-01', participantCount: 0, totalPrizePool: 750000 },
  { id: '4', title: 'Open Mic Q2 2024', type: 'open-mic', status: 'ended', startDate: '2024-04-01', endDate: '2024-06-30', participantCount: 298, totalPrizePool: 450000 },
];

const statusColor: Record<string, string> = {
  'draft': colors.muted,
  'upcoming': colors.warning,
  'active': colors.success,
  'ended': colors.secondary,
};

const typeLabel: Record<string, string> = {
  'open-mic': '🎤 Open Mic',
  'reality-tv': '📺 Reality TV',
  'multi-skill': '🎯 Multi-Skill',
  'other': '📋 Other',
};

export default function CompetitionsListPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [competitions, setCompetitions] = useState<Competition[]>(MOCK_COMPETITIONS);
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('competitions');
      if (stored) {
        try {
          setCompetitions(JSON.parse(stored));
        } catch {
          setCompetitions(MOCK_COMPETITIONS);
          localStorage.setItem('competitions', JSON.stringify(MOCK_COMPETITIONS));
        }
      } else {
        // Initialize localStorage with mock data on first load
        setCompetitions(MOCK_COMPETITIONS);
        localStorage.setItem('competitions', JSON.stringify(MOCK_COMPETITIONS));
      }
    }
  }, []);

  const filtered = useMemo(() => {
    return competitions.filter((c) => {
      const matchSearch = c.title.toLowerCase().includes(search.toLowerCase());
      const matchType = !filterType || c.type === filterType;
      const matchStatus = !filterStatus || c.status === filterStatus;
      return matchSearch && matchType && matchStatus;
    });
  }, [search, filterType, filterStatus, competitions]);

  return (
    <Page>
      <PageHeader
        title="Competitions Management"
        subtitle="Create, edit, and manage all contests across the platform."
        actions={<Button variant="primary" onClick={() => router.push('/admin/competitions/create')}>+ New Competition</Button>}
      />

      {/* Filters */}
      <Card title="Filters" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
          <Input
            placeholder="Search competitions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text
          }}>
            <option value="">All Types</option>
            <option value="open-mic">Open Mic</option>
            <option value="reality-tv">Reality TV</option>
            <option value="multi-skill">Multi-Skill</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text
          }}>
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
          </select>
        </div>
      </Card>

      {/* Competitions Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Title</th>
              <th style={thCell}>Type</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Participants</th>
              <th style={thCell}>Prize Pool</th>
              <th style={thCell}>Benefits</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={7}>No competitions found.</td></tr>
            ) : (
              filtered.map((comp) => (
                <tr key={comp.id} style={{ background: comp.status === 'active' ? tint(colors.success, 0.04) : 'transparent' }}>
                  <td style={tdCell}><strong>{comp.title}</strong></td>
                  <td style={tdCell}>{typeLabel[comp.type]}</td>
                  <td style={tdCell}><Badge text={comp.status} color={statusColor[comp.status]} /></td>
                  <td style={tdCell}>{comp.participantCount.toLocaleString()}</td>
                  <td style={tdCell}>{formatCurrency(comp.totalPrizePool)}</td>
                  <td style={tdCell}>
                    {comp.awards && comp.awards.some(a => a.benefits && a.benefits.length > 0) ? (
                      <span style={{ fontSize: '0.8rem', color: colors.success }}>
                        {comp.awards.reduce((sum, a) => sum + (a.benefits?.length || 0), 0)} benefit{comp.awards.reduce((sum, a) => sum + (a.benefits?.length || 0), 0) !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: colors.muted }}>None</span>
                    )}
                  </td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="outline" sm onClick={() => setSelectedComp(comp)}>Details</Button>
                      <Button variant="outline" sm>Edit</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
          Showing {filtered.length} of {competitions.length} competitions
        </div>
      </Card>

      {/* Details Modal */}
      {selectedComp && (
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
          <Card style={{ maxWidth: '600px', width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: colors.text }}>{selectedComp.title}</h2>
              <button
                onClick={() => setSelectedComp(null)}
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

            {selectedComp.banner && (
              <div style={{ marginBottom: '1rem' }}>
                <img
                  src={selectedComp.banner}
                  alt="Competition Banner"
                  style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '0.375rem' }}
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: colors.muted }}>Type:</span> {typeLabel[selectedComp.type]}
              </div>
              <div>
                <span style={{ color: colors.muted }}>Status:</span> <Badge text={selectedComp.status} color={statusColor[selectedComp.status]} />
              </div>
              <div>
                <span style={{ color: colors.muted }}>Prize Pool:</span> {formatCurrency(selectedComp.totalPrizePool)}
              </div>
              <div>
                <span style={{ color: colors.muted }}>Participants:</span> {selectedComp.participantCount}
              </div>
            </div>

            {selectedComp.awards && selectedComp.awards.length > 0 && (
              <div style={{ paddingTop: '1rem', borderTop: `1px solid ${colors.border}` }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: colors.text, marginBottom: '0.75rem' }}>
                  Position Awards & Benefits
                </h3>
                {selectedComp.awards.map((award) => (
                  <div key={award.position} style={{ marginBottom: '1rem', padding: '0.75rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `3px solid ${colors.primary}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${colors.border}` }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Position {award.position}: {award.title}</span>
                      {award.amount ? <span style={{ color: colors.success, fontWeight: 600 }}>{formatCurrency(award.amount)}</span> : null}
                    </div>
                    {award.benefits && award.benefits.length > 0 ? (
                      <div>
                        {award.benefits.map((benefit) => (
                          <div key={benefit.id} style={{ padding: '0.4rem 0', fontSize: '0.8rem' }}>
                            <span>{benefit.type === 'cash' ? '💰' : '🎁'} <strong>{benefit.name}</strong></span>
                            <div style={{ color: colors.muted, fontSize: '0.75rem', marginLeft: '1.2rem' }}>{benefit.description}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: colors.muted, fontSize: '0.8rem' }}>No benefits assigned</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
