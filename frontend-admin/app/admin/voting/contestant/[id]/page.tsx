'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card, Button, Badge, colors } from '@/components/ui/vuexy';

interface AuditEntry {
  id: string;
  created_at: string;
  vote_amount: number;
  admin_name?: string;
}

export default function ContestantProfilePage() {
  const params = useParams();
  const contestantId = params?.id as string;

  const [adminVotes, setAdminVotes] = useState(0);
  const [votingInProgress, setVotingInProgress] = useState(false);
  const [votingHistory, setVotingHistory] = useState<AuditEntry[]>([]);
  const [votesInput, setVotesInput] = useState('1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch votes from database or localStorage
  useEffect(() => {
    if (!contestantId) return;

    const fetchVotes = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/voting/contestant/${contestantId}`);

        if (response.ok) {
          const data = await response.json();
          setAdminVotes(data.adminVotes || 0);
          setVotingHistory(data.auditLog || []);
          setError(null);
        } else {
          // Fallback to localStorage if API fails (tables may not exist yet)
          const storedVotes = localStorage.getItem(`admin_votes_${contestantId}`);
          const storedHistory = localStorage.getItem(`vote_history_${contestantId}`);

          if (storedVotes) {
            setAdminVotes(JSON.parse(storedVotes));
          }
          if (storedHistory) {
            setVotingHistory(JSON.parse(storedHistory));
          }
          setError('Using local storage (database not yet configured)');
        }
      } catch (err) {
        console.error('Error fetching votes:', err);
        // Fallback to localStorage
        const storedVotes = localStorage.getItem(`admin_votes_${contestantId}`);
        const storedHistory = localStorage.getItem(`vote_history_${contestantId}`);

        if (storedVotes) {
          setAdminVotes(JSON.parse(storedVotes));
        }
        if (storedHistory) {
          setVotingHistory(JSON.parse(storedHistory));
        }
        setError('Using local storage (database error)');
      } finally {
        setLoading(false);
      }
    };

    fetchVotes();
  }, [contestantId]);

  // Mock data for all contestants
  const contestantData: Record<string, any> = {
    '1': {
      id: '1',
      name: 'Chioma Okonkwo',
      email: 'chioma@example.com',
      phone: '+234 805 678 9012',
      dateOfBirth: '1996-08-22',
      gender: 'Female',
      competition: 'Open Mic Q3',
      registrationDate: '2024-07-15',
      approvalStatus: 'approved',
      contestantNumber: 'OM-Q3-0041',
      bio: 'Award-winning poet and spoken word artist with international recognition.',
      currentVotes: 0,
      paidVotes: 0,
      totalVotes: 0,
    },
    '2': {
      id: '2',
      name: 'Tunde Adeyemi',
      email: 'tunde@example.com',
      phone: '+234 802 123 4567',
      dateOfBirth: '1998-03-15',
      gender: 'Male',
      competition: 'Open Mic Q3',
      registrationDate: '2024-07-18',
      approvalStatus: 'approved',
      contestantNumber: 'OM-Q3-0042',
      bio: 'Passionate musician and songwriter with 5 years of performance experience.',
      currentVotes: 0,
      paidVotes: 0,
      totalVotes: 0,
    },
    '3': {
      id: '3',
      name: 'Amara Ejiro',
      email: 'amara@example.com',
      phone: '+234 701 234 5678',
      dateOfBirth: '1995-12-10',
      gender: 'Female',
      competition: 'Reality TV',
      registrationDate: '2024-06-20',
      approvalStatus: 'approved',
      contestantNumber: 'RTV-Q3-0089',
      bio: 'Dynamic TV personality with 7 years of entertainment industry experience.',
      currentVotes: 0,
      paidVotes: 0,
      totalVotes: 0,
    },
    '4': {
      id: '4',
      name: 'Nonso Ifeanyi',
      email: 'nonso@example.com',
      phone: '+234 809 876 5432',
      dateOfBirth: '1999-04-05',
      gender: 'Male',
      competition: 'Open Mic Q3',
      registrationDate: '2024-07-12',
      approvalStatus: 'disqualified',
      contestantNumber: 'OM-Q3-0040',
      bio: 'Emerging comedy talent with a unique perspective on social issues.',
      currentVotes: 0,
      paidVotes: 0,
      totalVotes: 0,
    },
  };

  const contestant = contestantData[contestantId] || contestantData['2'];

  const handleAddVotes = async (e: React.FormEvent) => {
    e.preventDefault();
    setVotingInProgress(true);

    try {
      const votesToAdd = parseInt(votesInput) || 1;

      if (!contestantId) {
        setError('Contestant ID not found');
        return;
      }

      const newTotalVotes = adminVotes + votesToAdd;
      const newHistoryEntry: AuditEntry = {
        id: Date.now().toString(),
        created_at: new Date().toISOString(),
        vote_amount: votesToAdd,
        admin_name: 'Admin',
      };

      // Try to save to database
      let dbSuccess = false;
      try {
        const response = await fetch(`/api/voting/contestant/${contestantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voteCount: votesToAdd,
            adminName: 'Admin',
            adminId: 'system',
            competitionId: contestant.competition,
          }),
        });

        if (response.ok) {
          dbSuccess = true;
          setError(null);
        }
      } catch (dbErr) {
        console.warn('Database save failed, using localStorage:', dbErr);
      }

      // Update local state and localStorage
      setAdminVotes(newTotalVotes);
      const newHistory = [...votingHistory, newHistoryEntry];
      setVotingHistory(newHistory);

      // Save to localStorage as backup
      localStorage.setItem(`admin_votes_${contestantId}`, JSON.stringify(newTotalVotes));
      localStorage.setItem(`vote_history_${contestantId}`, JSON.stringify(newHistory));

      setVotesInput('1');

      if (dbSuccess) {
        alert(`✅ Added ${votesToAdd} vote(s) for ${contestant.name} (saved to database)`);
      } else {
        alert(`✅ Added ${votesToAdd} vote(s) for ${contestant.name} (local storage - awaiting database setup)`);
        if (!error) {
          setError('Saving to local storage (database not yet configured)');
        }
      }
    } catch (err) {
      console.error('Error adding votes:', err);
      setError(err instanceof Error ? err.message : 'Failed to add votes');
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Failed to add votes'}`);
    } finally {
      setVotingInProgress(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, minHeight: '100%', background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <p>Loading contestant data...</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, minHeight: '100%', background: colors.bg }}>
      {/* Error Banner */}
      {error && (
        <div style={{
          background: colors.danger + '20',
          border: `1px solid ${colors.danger}`,
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          color: colors.danger,
          fontSize: 13,
        }}>
          ❌ {error}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{contestant.name}</h1>
        <p style={{ margin: '8px 0 0', color: colors.muted, fontSize: 14 }}>
          Contestant ID: {contestant.contestantNumber} · {contestant.competition}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left: Profile */}
        <Card style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>📋 Profile Info</h2>

          <div
            style={{
              width: '100%',
              height: 180,
              background: `linear-gradient(135deg, ${colors.primary}40, ${colors.secondary}40)`,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 56,
            }}
          >
            📸
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600, width: '40%' }}>Email</td>
                <td style={{ padding: '8px 0' }}>{contestant.email}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Phone</td>
                <td style={{ padding: '8px 0' }}>{contestant.phone}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Gender</td>
                <td style={{ padding: '8px 0' }}>{contestant.gender}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Contestant #</td>
                <td style={{ padding: '8px 0' }}>{contestant.contestantNumber}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Registered</td>
                <td style={{ padding: '8px 0' }}>
                  {new Date(contestant.registrationDate).toLocaleDateString('en-NG')}
                </td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Status</td>
                <td style={{ padding: '8px 0' }}>
                  <Badge text={contestant.approvalStatus} color={colors.success} />
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Bio</h3>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: colors.muted,
                background: colors.headBg,
                padding: 10,
                borderRadius: 6,
              }}
            >
              {contestant.bio}
            </p>
          </div>
        </Card>

        {/* Right: Voting */}
        <Card style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>🗳️ Voting Dashboard</h2>

          {/* Vote Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.success}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>FREE VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.success }}>{contestant.currentVotes}</div>
            </div>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.warning}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>PAID VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.warning }}>{contestant.paidVotes}</div>
            </div>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.primary}`, gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>TOTAL + ADMIN VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.primary }}>{contestant.totalVotes + adminVotes}</div>
            </div>
          </div>

          {/* Voting Form */}
          <form onSubmit={handleAddVotes} style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Add Admin Votes (Unlimited)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min="1"
                max="9999"
                value={votesInput}
                onChange={(e) => setVotesInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
              <Button variant="primary" type="submit" disabled={votingInProgress}>
                {votingInProgress ? '⏳' : '➕'} Add
              </Button>
            </div>
          </form>

          {/* History */}
          {votingHistory.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600 }}>History ({votingHistory.length})</h3>
              <div style={{ background: colors.headBg, borderRadius: 4, maxHeight: 150, overflowY: 'auto' }}>
                {votingHistory.map((entry, idx) => (
                  <div
                    key={entry.id || idx}
                    style={{
                      padding: '6px 10px',
                      borderBottom: idx < votingHistory.length - 1 ? `1px solid ${colors.border}` : 'none',
                      fontSize: 11,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>
                      <strong>+{entry.vote_amount}</strong> vote{entry.vote_amount !== 1 ? 's' : ''} {entry.admin_name && <span style={{ color: colors.muted }}>({entry.admin_name})</span>}
                    </span>
                    <span style={{ color: colors.muted }}>
                      {new Date(entry.created_at).toLocaleString('en-NG')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Rules */}
      <Card style={{ padding: 16, marginTop: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>ℹ️ Voting Rules</h3>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: '8px 0', fontWeight: 600, width: '25%' }}>Public</td>
              <td style={{ padding: '8px 0' }}>1 free vote per contestant per day (enforced)</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: '8px 0', fontWeight: 600 }}>Paid</td>
              <td style={{ padding: '8px 0' }}>Unlimited votes. Charged per purchase. Separate from free votes.</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 600 }}>Admin</td>
              <td style={{ padding: '8px 0' }}>
                <strong>Unlimited votes. No restrictions. Used for judgment/moderation. Audited.</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
