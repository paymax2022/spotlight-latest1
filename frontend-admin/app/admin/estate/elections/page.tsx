'use client';

// A-EST-OV-06 — Platform election integrity (estate.admin.election).
// Election list + per-election results tally and integrity audit
// (ballots cast vs distinct voters; DB-enforced one-vote-per-resident).

import { useCallback, useEffect, useState } from 'react';
import {
  listOversightElections, getElectionResults, getElectionAudit,
} from '@/services/estateAdminService';
import type { OversightElection, ElectionResultRow, ElectionAudit } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Election integrity" subtitle="Election results tally and integrity audit. One ballot per resident is enforced at the DB layer." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="elections" />
      {!canView ? <Restricted perm="estate.admin.election" /> : (
        <>
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading elections…</p> : (
            <>
              <Card title="Elections" style={{ marginBottom: '1.25rem' }}>
                {elections.length === 0 ? <p style={{ color: colors.muted }}>No elections.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Title</th><th style={thCell}>Status</th><th style={thCell}>Created</th><th style={thCell} /></tr></thead>
                    <tbody>
                      {elections.map((e) => (
                        <tr key={e.id}>
                          <td style={tdCell}>{e.estateId}</td>
                          <td style={tdCell}><strong>{e.title}</strong></td>
                          <td style={tdCell}><Badge text={cap(e.status)} color={e.status === 'tallied' ? colors.success : e.status === 'open' ? colors.info : e.status === 'draft' ? colors.warning : colors.secondary} /></td>
                          <td style={tdCell}>{timeAgo(e.createdAt)}</td>
                          <td style={tdCell}><Button variant="outline" sm onClick={() => void openElection(e.id)}>Audit →</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {selected && (
                <Card title={`Integrity — ${elections.find((e) => e.id === selected)?.title ?? selected}`}>
                  {drillLoading ? <p style={{ color: colors.muted }}>Loading tally…</p> : (
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
                        <p style={{ color: colors.danger, fontSize: '0.85rem', marginTop: 0 }}>
                          Double-vote detected: ballots_cast ≠ distinct_voters. This should be impossible (UNIQUE constraint) — investigate data integrity.
                        </p>
                      )}
                      {results.length === 0 ? <p style={{ color: colors.muted }}>No candidates.</p> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={thCell}>Candidate</th><th style={thCell}>Bio</th><th style={thCell}>Votes</th><th style={thCell}>Share</th></tr></thead>
                          <tbody>
                            {results.map((r) => (
                              <tr key={r.candidateId}>
                                <td style={tdCell}><strong>{r.name}</strong></td>
                                <td style={tdCell}>{r.bio || '—'}</td>
                                <td style={tdCell}>{r.votes}</td>
                                <td style={tdCell}>{totalVotes > 0 ? `${Math.round((r.votes / totalVotes) * 100)}%` : '0%'}</td>
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
    </Page>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', background: colors.card, borderLeft: `3px solid ${bad ? colors.danger : colors.primary}` }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, color: bad ? colors.danger : colors.text }}>{value}</div>
    </div>
  );
}
