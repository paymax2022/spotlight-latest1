'use client';

// A-EST-OV-06 — Platform election integrity (estate.admin.election).
// Election list + per-election results tally and integrity audit
// (ballots cast vs distinct voters; DB-enforced one-vote-per-resident).

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightElections, getElectionResults, getElectionAudit,
} from '@/services/estateAdminService';
import type { OversightElection, ElectionResultRow, ElectionAudit } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

export default function ElectionIntegrityPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.election);

  const [elections, setElections] = useState<OversightElection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<ElectionResultRow[]>([]);
  const [audit, setAudit] = useState<ElectionAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillLoading, setDrillLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try { setElections(await listOversightElections()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  const openElection = useCallback(async (id: string) => {
    setSelected(id); setDrillLoading(true); setError(null);
    try {
      const [r, a] = await Promise.all([getElectionResults(id), getElectionAudit(id)]);
      setResults(r); setAudit(a);
    } catch (e) { setError(String(e)); }
    finally { setDrillLoading(false); }
  }, []);

  const totalVotes = results.reduce((s, r) => s + r.votes, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Election integrity" subtitle="Election results tally and integrity audit. One ballot per resident is enforced at the DB layer." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="elections" />
      {!canView ? <Restricted perm="estate.admin.election" /> : (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading elections…</p> : (
            <>
              <Card title="Elections">
                {elections.length === 0 ? <p style={{ color: '#6b7280' }}>No elections.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Title</th><th style={th()}>Status</th><th style={th()}>Created</th><th style={th()} /></tr></thead>
                    <tbody>
                      {elections.map((e) => (
                        <tr key={e.id}>
                          <td style={td()}>{e.estateId}</td>
                          <td style={td()}><strong>{e.title}</strong></td>
                          <td style={td()}><Badge status={e.status === 'tallied' ? 'resolved' : e.status === 'open' ? 'active' : e.status === 'draft' ? 'pending' : 'low'} label={e.status} /></td>
                          <td style={td()}>{timeAgo(e.createdAt)}</td>
                          <td style={td()}><button onClick={() => void openElection(e.id)} style={btn()}>Audit →</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {selected && (
                <Card title={`Integrity — ${elections.find((e) => e.id === selected)?.title ?? selected}`}>
                  {drillLoading ? <p style={{ color: '#6b7280' }}>Loading tally…</p> : (
                    <>
                      {audit && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
                          <Stat label="Ballots cast" value={String(audit.ballotsCast)} />
                          <Stat label="Distinct voters" value={String(audit.distinctVoters)} />
                          <Stat label="Candidates" value={String(audit.candidates)} />
                          <Stat label="Integrity" value={audit.doubleVoteDetected ? 'FLAGGED' : 'OK'} bad={audit.doubleVoteDetected} />
                        </div>
                      )}
                      {audit?.doubleVoteDetected && (
                        <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: 0 }}>
                          Double-vote detected: ballots_cast ≠ distinct_voters. This should be impossible (UNIQUE constraint) — investigate data integrity.
                        </p>
                      )}
                      {results.length === 0 ? <p style={{ color: '#6b7280' }}>No candidates.</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={th()}>Candidate</th><th style={th()}>Bio</th><th style={th()}>Votes</th><th style={th()}>Share</th></tr></thead>
                          <tbody>
                            {results.map((r) => (
                              <tr key={r.candidateId}>
                                <td style={td()}><strong>{r.name}</strong></td>
                                <td style={td()}>{r.bio || '—'}</td>
                                <td style={td()}>{r.votes}</td>
                                <td style={td()}>{totalVotes > 0 ? `${Math.round((r.votes / totalVotes) * 100)}%` : '0%'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.7rem 0.9rem', background: '#fff', borderLeft: `3px solid ${bad ? '#dc2626' : '#7c3aed'}` }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: bad ? '#b91c1c' : '#111827' }}>{value}</div>
    </div>
  );
}
