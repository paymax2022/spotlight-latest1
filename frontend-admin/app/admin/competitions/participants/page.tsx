'use client';

import { useState, useMemo } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Participant = {
  id: string;
  name: string;
  email: string;
  competition: string;
  status: 'pending' | 'qualified' | 'disqualified' | 'withdrawn';
  submissionDate: string;
  score?: number;
};

const MOCK_PARTICIPANTS: Participant[] = [
  { id: '1', name: 'Chioma Okonkwo', email: 'chioma@example.com', competition: 'Open Mic Q3', status: 'qualified', submissionDate: '2024-07-15', score: 87 },
  { id: '2', name: 'Tunde Adeyemi', email: 'tunde@example.com', competition: 'Open Mic Q3', status: 'pending', submissionDate: '2024-07-18' },
  { id: '3', name: 'Amara Ejiro', email: 'amara@example.com', competition: 'Reality TV', status: 'qualified', submissionDate: '2024-06-20', score: 92 },
  { id: '4', name: 'Nonso Ifeanyi', email: 'nonso@example.com', competition: 'Open Mic Q3', status: 'disqualified', submissionDate: '2024-07-12' },
];

const statusColor: Record<string, string> = {
  'pending': colors.warning,
  'qualified': colors.success,
  'disqualified': colors.danger,
  'withdrawn': colors.muted,
};

export default function ParticipantsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const filtered = useMemo(() => {
    return MOCK_PARTICIPANTS.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase());
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [search, filterStatus]);

  return (
    <Page>
      <PageHeader
        title="Participants & Entries"
        subtitle="Review submissions, manage qualifications, and handle participant issues."
        actions={<Button variant="outline">Export List</Button>}
      />

      {/* Filters */}
      <Card title="Search & Filter" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text
          }}>
            <option value="">All Status</option>
            <option value="pending">Pending Review</option>
            <option value="qualified">Qualified</option>
            <option value="disqualified">Disqualified</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </Card>

      {/* Participants Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}>Name</th>
              <th style={thCell}>Email</th>
              <th style={thCell}>Competition</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Score</th>
              <th style={thCell}>Submitted</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={7}>No participants found.</td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id}>
                  <td style={tdCell}><strong>{p.name}</strong></td>
                  <td style={{ ...tdCell, color: colors.muted, fontSize: '0.8rem' }}>{p.email}</td>
                  <td style={tdCell}>{p.competition}</td>
                  <td style={tdCell}><Badge text={p.status} color={statusColor[p.status]} /></td>
                  <td style={tdCell}>{p.score ? `${p.score}%` : '—'}</td>
                  <td style={{ ...tdCell, color: colors.muted, fontSize: '0.85rem' }}>{new Date(p.submissionDate).toLocaleDateString('en-NG')}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="outline" sm>View Entry</Button>
                      {p.status === 'pending' && <Button variant="primary" sm>Review</Button>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
          Showing {filtered.length} of {MOCK_PARTICIPANTS.length} participants
        </div>
      </Card>
    </Page>
  );
}
