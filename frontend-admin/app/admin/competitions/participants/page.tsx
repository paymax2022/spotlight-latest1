'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Demo mode: allow preview without authentication if ?demo=1
function useDemoMode() {
  const router = useRouter();
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const isDemoParam = params.has('demo');
      setIsDemo(isDemoParam);
    }
  }, []);

  return isDemo;
}

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
  const router = useRouter();
  const isDemo = useDemoMode();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

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
                      <Button variant="outline" sm onClick={() => router.push(`/admin/voting/contestant/${p.id}`)}>🗳️ Vote</Button>
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

      {/* Entry Details Modal */}
      {selectedParticipant && (
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
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: colors.text }}>Entry Details</h2>
              <button
                onClick={() => setSelectedParticipant(null)}
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
              <div><span style={{ color: colors.muted }}>Name:</span> <strong>{selectedParticipant.name}</strong></div>
              <div><span style={{ color: colors.muted }}>Email:</span> {selectedParticipant.email}</div>
              <div><span style={{ color: colors.muted }}>Competition:</span> {selectedParticipant.competition}</div>
              <div><span style={{ color: colors.muted }}>Status:</span> <Badge text={selectedParticipant.status} color={statusColor[selectedParticipant.status]} /></div>
              {selectedParticipant.score && <div><span style={{ color: colors.muted }}>Score:</span> <strong>{selectedParticipant.score}%</strong></div>}
              <div><span style={{ color: colors.muted }}>Submitted:</span> {new Date(selectedParticipant.submissionDate).toLocaleDateString('en-NG')}</div>
              <div style={{ marginTop: '1rem', padding: '1rem', background: colors.inputBorder + '20', borderRadius: '0.375rem', color: colors.muted }}>
                Entry submission content would display here...
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <Button variant="outline" onClick={() => setSelectedParticipant(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Review Modal */}
      {reviewingId && (
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
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: colors.text }}>Review Entry</h2>
              <button
                onClick={() => setReviewingId(null)}
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
            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
              <div style={{ padding: '0.75rem', background: colors.inputBorder + '20', borderRadius: '0.375rem' }}>
                <strong>Entry Content</strong><br />
                <span style={{ color: colors.muted, fontSize: '0.8rem' }}>Review the submission and make your decision</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="primary" onClick={() => { setReviewingId(null); alert('Entry qualified!'); }}>Qualify</Button>
              <Button variant="danger" onClick={() => { setReviewingId(null); alert('Entry disqualified!'); }}>Disqualify</Button>
              <Button variant="outline" onClick={() => setReviewingId(null)}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
