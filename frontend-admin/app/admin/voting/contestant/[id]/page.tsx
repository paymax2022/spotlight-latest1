'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, Button, Badge, Input, colors } from '@/components/ui/vuexy';
import { getContestant, castAdminVote } from '@/services/competitionsService';
import type { ContestRosterEntry } from '@/types/competitions';

// Real contestant profile + real vote counts — GET /api/v1/connect/contestants/:id.
// Previously this page kept a hardcoded contestantData map (4 fake people with
// invented emails/phones/DOBs) and "Add Admin Votes" wrote to localStorage
// only, after a fetch('/api/voting/contestant/...') that had no real handler
// behind it to fail into. There is no email/phone/DOB/gender/registration-
// status concept on a real contestant record here (ContestRosterEntry has
// name, stage_name, category, state, bio, photo_url, status, votes, rank) —
// shown as-is rather than padded out with fields that don't exist.

export default function ContestantProfilePage() {
  const params = useParams();
  const contestantId = params?.id as string;

  const [contestant, setContestant] = useState<ContestRosterEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votesInput, setVotesInput] = useState('1');
  const [voting, setVoting] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    if (!contestantId) return;
    setLoading(true);
    setError(null);
    try {
      setContestant(await getContestant(contestantId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contestant');
    } finally {
      setLoading(false);
    }
  }, [contestantId]);

  useEffect(() => { void load(); }, [load]);

  const handleAddVotes = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contestant) return;
    const qty = parseInt(votesInput, 10) || 1;
    setVoting(true);
    setError(null);
    try {
      await castAdminVote(contestant.contest_id || '', contestant.contestant_id, qty);
      setToast(`Added ${qty} admin vote${qty === 1 ? '' : 's'} for ${contestant.name}`);
      setTimeout(() => setToast(''), 3000);
      setVotesInput('1');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add votes');
    } finally {
      setVoting(false);
    }
  }, [contestant, votesInput, load]);

  if (loading && !contestant) {
    return <div style={{ padding: 24 }}><Card style={{ textAlign: 'center', padding: 32 }}><p>Loading contestant…</p></Card></div>;
  }
  if (!contestant) {
    return <div style={{ padding: 24 }}><Card style={{ padding: 32 }}><p style={{ color: colors.danger }}>{error || 'Contestant not found'}</p></Card></div>;
  }

  return (
    <div style={{ padding: 24, minHeight: '100%', background: colors.bg }}>
      {toast && (
        <div style={{ background: colors.success + '20', border: `1px solid ${colors.success}`, borderRadius: 8, padding: 12, marginBottom: 16, color: colors.success, fontSize: 13 }}>
          ✅ {toast}
        </div>
      )}
      {error && (
        <div style={{ background: colors.danger + '20', border: `1px solid ${colors.danger}`, borderRadius: 8, padding: 12, marginBottom: 16, color: colors.danger, fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{contestant.name}</h1>
        {contestant.stage_name ? (
          <p style={{ margin: '4px 0 0', color: colors.muted, fontSize: 14 }}>&ldquo;{contestant.stage_name}&rdquo;</p>
        ) : null}
        <p style={{ margin: '8px 0 0', color: colors.muted, fontSize: 14 }}>
          {contestant.category || 'Uncategorized'} · {contestant.state || 'No state on file'} · Rank #{contestant.rank || '—'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>📋 Profile</h2>

          {contestant.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contestant.photo_url} alt={contestant.name} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 16 }} />
          ) : (
            <div style={{ width: '100%', height: 180, background: `linear-gradient(135deg, ${colors.primary}40, ${colors.secondary}40)`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 56 }}>
              📸
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600, width: '40%' }}>Category</td>
                <td style={{ padding: '8px 0' }}>{contestant.category || '—'}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>State</td>
                <td style={{ padding: '8px 0' }}>{contestant.state || '—'}</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Status</td>
                <td style={{ padding: '8px 0' }}>
                  <Badge text={contestant.is_active ? contestant.status : `${contestant.status} (inactive)`} color={contestant.is_active ? colors.success : colors.muted} />
                </td>
              </tr>
            </tbody>
          </table>

          {contestant.bio ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Bio</h3>
              <p style={{ margin: 0, fontSize: 12, color: colors.muted, background: colors.headBg, padding: 10, borderRadius: 6 }}>{contestant.bio}</p>
            </div>
          ) : null}
        </Card>

        <Card style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>🗳️ Voting Dashboard</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.success}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>FREE VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.success }}>{contestant.free_votes}</div>
            </div>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.warning}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>PAID VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.warning }}>{contestant.paid_votes}</div>
            </div>
            <div style={{ background: colors.bg, padding: 12, borderRadius: 6, borderLeft: `3px solid ${colors.primary}`, gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>TOTAL VOTES</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.primary }}>{contestant.total_votes}</div>
            </div>
          </div>

          <form onSubmit={handleAddVotes} style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Add Admin Votes (unlimited, real ledger — connect_votes)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input type="number" min={1} max={9999} value={votesInput} onChange={(e) => setVotesInput(e.target.value)} style={{ flex: 1 }} />
              <Button variant="primary" type="submit" disabled={voting || !contestant.contest_id}>
                {voting ? '⏳' : '➕'} Add
              </Button>
            </div>
            {!contestant.contest_id && (
              <p style={{ fontSize: 11, color: colors.warning, marginTop: 6 }}>
                This contestant has no linked contest_id — admin voting is unavailable for them.
              </p>
            )}
          </form>
        </Card>
      </div>

      <Card style={{ padding: 16, marginTop: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>ℹ️ Voting Rules</h3>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: '8px 0', fontWeight: 600, width: '25%' }}>Public</td>
              <td style={{ padding: '8px 0' }}>Free + paid votes per the contest&apos;s own configuration (velocity + tier limits enforced server-side).</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 600 }}>Admin</td>
              <td style={{ padding: '8px 0' }}>
                <strong>Unlimited votes, no payment. Requires connect.contests.manage. Posted to the same connect_votes table as public votes — reflected on mobile immediately.</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
