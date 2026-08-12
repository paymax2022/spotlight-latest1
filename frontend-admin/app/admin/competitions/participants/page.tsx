'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Registration = {
  id: string;
  reference: string;
  user_id: string | null;
  contest_slug: string;
  status: string;
  form_data: Record<string, any>;
  completion_percent: number;
  created_at: string;
  submitted_at: string | null;
};

type Participant = {
  id: string;
  name: string;
  email: string;
  competition: string;
  status: 'draft' | 'submitted' | 'awaiting_payment' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';
  submissionDate: string;
  reference: string;
  completionPercent: number;
};

const statusColor: Record<string, string> = {
  'draft': colors.muted,
  'submitted': colors.warning,
  'awaiting_payment': colors.warning,
  'under_review': colors.info,
  'approved': colors.success,
  'rejected': colors.danger,
  'withdrawn': colors.muted,
};

export default function ParticipantsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch registrations from Supabase REST API
  useEffect(() => {
    async function fetchRegistrations() {
      try {
        setLoading(true);
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

        // Fetch directly from REST API without JWT authentication
        const response = await fetch(`${supabaseUrl}/rest/v1/registrations?order=created_at.desc`, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const data: Registration[] = await response.json();

        // Transform Supabase rows to Participant format
        const transformed: Participant[] = (data || []).map((reg: Registration) => ({
          id: reg.id,
          reference: reg.reference,
          name: `${reg.form_data['personal.firstName'] || ''} ${reg.form_data['personal.lastName'] || ''}`.trim() || 'Unknown',
          email: reg.form_data['account.email'] || reg.form_data['personal.email'] || '',
          competition: reg.contest_slug,
          status: reg.status as Participant['status'],
          submissionDate: reg.submitted_at || reg.created_at,
          completionPercent: reg.completion_percent,
        }));

        setParticipants(transformed);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch registrations:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch participants');
        setParticipants([]);
      } finally {
        setLoading(false);
      }
    }

    fetchRegistrations();
  }, []);

  const filtered = useMemo(() => {
    return participants.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase()) ||
        p.reference.toLowerCase().includes(search.toLowerCase());
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [search, filterStatus, participants]);

  if (error) {
    return (
      <Page>
        <PageHeader
          title="Participants & Entries"
          subtitle="Review submissions, manage qualifications, and handle participant issues."
        />
        <Card style={{ padding: '2rem', textAlign: 'center', color: colors.danger }}>
          <p><strong>Error loading participants:</strong> {error}</p>
          <p style={{ fontSize: '0.9rem', color: colors.muted, marginTop: '1rem' }}>
            <strong>Setup required:</strong> The registrations database table needs to be created in Supabase.
          </p>
          <p style={{ fontSize: '0.85rem', color: colors.muted, textAlign: 'left', background: colors.inputBorder + '20', padding: '1rem', borderRadius: '0.375rem', marginTop: '1rem', fontFamily: 'monospace' }}>
            Run:<br/>
            <code>supabase db push --include-all</code><br/>
            <br/>
            Or manually create the table in Supabase with the migration in:<br/>
            <code>supabase/migrations/20260811232202_add_registrations_table.sql</code>
          </p>
          <Button variant="outline" onClick={() => window.location.reload()} style={{ marginTop: '1rem' }}>
            Retry After Setup
          </Button>
        </Card>
      </Page>
    );
  }

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
            placeholder="Search by name, email, or reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{
            padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
            fontSize: '0.85rem', background: colors.card, cursor: 'pointer', color: colors.text
          }}>
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="awaiting_payment">Awaiting Payment</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </Card>

      {/* Participants Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: colors.muted }}>
            Loading participants...
          </div>
        ) : (
          <>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thCell}>Reference</th>
                  <th style={thCell}>Name</th>
                  <th style={thCell}>Email</th>
                  <th style={thCell}>Competition</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Progress</th>
                  <th style={thCell}>Submitted</th>
                  <th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td style={{ ...tdCell, color: colors.muted, textAlign: 'center' }} colSpan={8}>
                    {participants.length === 0 ? 'No participants yet.' : 'No participants match your search.'}
                  </td></tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id}>
                      <td style={{ ...tdCell, fontSize: '0.8rem', fontFamily: 'monospace', color: colors.muted }}>{p.reference}</td>
                      <td style={tdCell}><strong>{p.name}</strong></td>
                      <td style={{ ...tdCell, color: colors.muted, fontSize: '0.8rem' }}>{p.email}</td>
                      <td style={tdCell}>{p.competition}</td>
                      <td style={tdCell}><Badge text={p.status} color={statusColor[p.status] || colors.muted} /></td>
                      <td style={tdCell}>{p.completionPercent}%</td>
                      <td style={{ ...tdCell, color: colors.muted, fontSize: '0.85rem' }}>
                        {p.submissionDate ? new Date(p.submissionDate).toLocaleDateString('en-NG') : '—'}
                      </td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button variant="outline" sm onClick={() => setSelectedParticipant(p)}>📋 View</Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div style={{ padding: '12px 14px', borderTop: `1px solid ${colors.border}`, fontSize: '0.85rem', color: colors.muted }}>
              Showing {filtered.length} of {participants.length} participants
            </div>
          </>
        )}
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
          <Card style={{ maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
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
              <div><span style={{ color: colors.muted }}>Reference:</span> <strong style={{ fontFamily: 'monospace' }}>{selectedParticipant.reference}</strong></div>
              <div><span style={{ color: colors.muted }}>Name:</span> <strong>{selectedParticipant.name}</strong></div>
              <div><span style={{ color: colors.muted }}>Email:</span> {selectedParticipant.email}</div>
              <div><span style={{ color: colors.muted }}>Competition:</span> {selectedParticipant.competition}</div>
              <div><span style={{ color: colors.muted }}>Status:</span> <Badge text={selectedParticipant.status} color={statusColor[selectedParticipant.status] || colors.muted} /></div>
              <div><span style={{ color: colors.muted }}>Progress:</span> <strong>{selectedParticipant.completionPercent}%</strong></div>
              <div><span style={{ color: colors.muted }}>Submitted:</span> {new Date(selectedParticipant.submissionDate).toLocaleDateString('en-NG')}</div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <Button variant="outline" onClick={() => setSelectedParticipant(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
