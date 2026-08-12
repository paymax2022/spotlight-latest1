'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  getElection, getElectionTally, addElectionCandidate,
  openElection, closeElection, publishElectionResults, handoverElection,
  type AdminElectionDetail, type AdminPositionResult, type ElectionHandoverResult,
} from '@/services/associationAdminService';
import { PageHeader, AssociationTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, th, td, input, label, fmtDate } from '../../_ui';

export default function ElectionManagePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [election, setElection] = useState<AdminElectionDetail | null>(null);
  const [tally, setTally] = useState<AdminPositionResult[]>([]);
  const [handover, setHandover] = useState<ElectionHandoverResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cand, setCand] = useState<Record<string, { membershipId: string; manifesto: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const e = await getElection(id);
      setElection(e);
      setTally(e.status === 'VOTING' || e.status === 'CLOSED' || e.status === 'PUBLISHED' ? await getElectionTally(id) : []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(key); setMsg(null);
    try { await fn(); setMsg('Done — recorded to the audit log.'); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function doHandover() {
    if (!window.confirm('Run handover? Winners will be granted their role and the outgoing holders revoked. This cannot be undone.')) return;
    setBusy('handover'); setMsg(null);
    try { const res = await handoverElection(id); setHandover(res); setMsg('Handover complete — roles transferred and audited.'); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  async function addCandidate(positionId: string) {
    const c = cand[positionId];
    if (!c?.membershipId?.trim()) { setMsg('Enter the member ID to nominate.'); return; }
    setBusy(`cand-${positionId}`); setMsg(null);
    try {
      await addElectionCandidate(id, { positionId, membershipId: c.membershipId.trim(), manifesto: c.manifesto?.trim() || undefined });
      setCand((prev) => ({ ...prev, [positionId]: { membershipId: '', manifesto: '' } }));
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  const status = election?.status;
  const published = status === 'PUBLISHED';
  const resultsByPos = (pid: string) => election?.results?.find((r) => r.positionId === pid);
  const turnoutByPos = (pid: string) => tally.find((t) => t.positionId === pid);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={election?.title ?? 'Election'}
        subtitle="Manage candidates, run the electoral lifecycle, and monitor turnout. Results are sealed until published."
        action={<Link href="/admin/association/elections" style={{ ...btn(), textDecoration: 'none' }}>← All elections</Link>}
      />
      <AssociationTabs active="elections" />

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!election} emptyText="Election not found.">
        {election && (
          <>
            {/* Lifecycle */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Badge status={election.status} />
                <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>
                  {election.votingOpensAt ? `Opens ${fmtDate(election.votingOpensAt)}` : 'No open time'} · {election.votingClosesAt ? `Closes ${fmtDate(election.votingClosesAt)}` : 'No close time'}
                </span>
                <div style={{ flex: 1 }} />
                {(status === 'DRAFT' || status === 'NOMINATION') && (
                  <button style={btnPrimary()} disabled={busy === 'open'} onClick={() => act('open', () => openElection(id), 'Open voting now? Members will be able to cast ballots.')}>Open voting</button>
                )}
                {status === 'VOTING' && (
                  <button style={btnPrimary()} disabled={busy === 'close'} onClick={() => act('close', () => closeElection(id), 'Close voting? No further ballots will be accepted.')}>Close voting</button>
                )}
                {status === 'CLOSED' && (
                  <button style={btnPrimary()} disabled={busy === 'publish'} onClick={() => act('publish', () => publishElectionResults(id), 'Publish results? The tally is snapshotted and locked (immutable).')}>Publish results</button>
                )}
                {status === 'PUBLISHED' && (
                  <button style={btnPrimary()} disabled={busy === 'handover'} onClick={doHandover}>Run role handover</button>
                )}
              </div>
              <DisclosureNote>
                {status === 'VOTING' || status === 'CLOSED'
                  ? 'Live tally is sealed (AD-005): only turnout is shown until results are published.'
                  : status === 'PUBLISHED'
                  ? 'Results are published and immutable. Handover grants winners their role and revokes the outgoing exec.'
                  : 'Add candidates below, then open voting. Eligibility and one-member-one-vote are enforced server-side.'}
              </DisclosureNote>
            </Card>

            {/* Handover summary */}
            {handover && (
              <div style={{ marginTop: '1rem' }}>
                <Card>
                  <strong style={{ fontSize: '0.9rem' }}>Handover complete</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                    <thead><tr><th style={th()}>Position</th><th style={th()}>Role granted</th><th style={th()}>Winner(s)</th><th style={th()}>Revoked</th></tr></thead>
                    <tbody>
                      {handover.positions.map((p) => (
                        <tr key={p.positionId}><td style={td()}>{p.title}</td><td style={td()}><code>{p.role}</code></td><td style={td()}>{p.winners.join(', ') || '—'}</td><td style={td()}>{p.revoked}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {/* Positions */}
            {election.positions.map((p) => {
              const res = resultsByPos(p.id);
              const turnout = turnoutByPos(p.id);
              return (
                <div key={p.id} style={{ marginTop: '1rem' }}>
                  <Card>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '0.95rem' }}>{p.title}</strong>
                      <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{p.seats} seat{p.seats === 1 ? '' : 's'}{p.role ? ` · confers ${p.role}` : ''}</span>
                      <div style={{ flex: 1 }} />
                      {turnout && <span style={{ fontSize: '0.8rem', color: '#374151' }}>Turnout: <strong>{turnout.ballotsCast}</strong> ballot{turnout.ballotsCast === 1 ? '' : 's'}</span>}
                    </div>

                    {/* Candidates / results */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.6rem' }}>
                      <thead><tr><th style={th()}>Candidate</th><th style={th()}>Manifesto</th>{published && <th style={th()}>Votes</th>}{published && <th style={th()}>Result</th>}</tr></thead>
                      <tbody>
                        {(published && res ? res.results.map((r) => ({ id: r.candidateId, name: r.name, manifesto: '', votes: r.votes, isWinner: r.isWinner })) : p.candidates.map((c) => ({ id: c.id, name: c.name, manifesto: c.manifesto, votes: undefined, isWinner: false }))).map((c) => (
                          <tr key={c.id}>
                            <td style={td()}>{c.name}</td>
                            <td style={{ ...td(), color: '#6b7280', fontSize: '0.8rem' }}>{c.manifesto || '—'}</td>
                            {published && <td style={td()}><strong>{c.votes}</strong></td>}
                            {published && <td style={td()}>{c.isWinner ? <Badge status="winner" /> : ''}</td>}
                          </tr>
                        ))}
                        {p.candidates.length === 0 && !published && (
                          <tr><td style={{ ...td(), color: '#9ca3af' }} colSpan={2}>No candidates yet.</td></tr>
                        )}
                      </tbody>
                    </table>

                    {/* Add candidate (only pre-voting) */}
                    {(status === 'DRAFT' || status === 'NOMINATION') && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <label style={label()}>Member ID</label>
                          <input style={input()} value={cand[p.id]?.membershipId ?? ''} onChange={(e) => setCand((prev) => ({ ...prev, [p.id]: { membershipId: e.target.value, manifesto: prev[p.id]?.manifesto ?? '' } }))} placeholder="membership UUID" />
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label style={label()}>Manifesto</label>
                          <input style={input()} value={cand[p.id]?.manifesto ?? ''} onChange={(e) => setCand((prev) => ({ ...prev, [p.id]: { membershipId: prev[p.id]?.membershipId ?? '', manifesto: e.target.value } }))} placeholder="Optional" />
                        </div>
                        <button style={btnPrimary()} disabled={busy === `cand-${p.id}`} onClick={() => addCandidate(p.id)}>Nominate</button>
                      </div>
                    )}
                  </Card>
                </div>
              );
            })}
          </>
        )}
      </StateBlock>
    </div>
  );
}
