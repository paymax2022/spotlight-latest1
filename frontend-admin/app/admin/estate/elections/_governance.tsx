'use client';

// Election governance console (Phase 2.2 — EST-UAT-0203…0230).
//
// This drives the estate-scoped Go workflow: configure → rules → roll → nominations →
// open → close → certify(tally) → outcome, plus the challenges/complaints/recounts that
// sit between those gates. Every action is refused server-side unless the estate_admin
// resident role holds it, so buttons here never pretend to be authoritative — the Go
// service is the gate, and its 409/403 is surfaced verbatim.

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  addRollException, buildElectionRoll, cancelElection, certifyNomination, challengeRollEntry,
  closeElection, decideElectionRules, decideNomination, fileElectionComplaint, freezeElectionRoll,
  getElectionOutcome, getElectionTurnout, listElectionComplaints, listElectionRecounts,
  listElectionRoll, listElectionRuleProposals, listNominations, listRollChallenges,
  removeRollEntry, resolveElectionComplaint, resolveRollChallenge, runElectionRecount,
  tallyElection, nominate, proposeElectionRules, updateElectionConfig, vetNomination, openElection,
} from '@/services/estateAdminService';
import type {
  ElectionComplaintRow, ElectionGovernanceState, ElectionOutcomeRow, ElectionRecountRow,
  ElectionRollEntryRow, ElectionRollRow, ElectionTurnoutRow, NominationRow, RollChallengeRow, RuleProposalRow,
} from '@/types/estateAdmin';
import { Button, Card, Input, colors, tdCell, thCell } from '@/components/ui/vuexy';

const label: CSSProperties = { fontSize: '0.75rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 4 };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const select: CSSProperties = { padding: '0.4rem 0.5rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, fontSize: '0.85rem' };
const row: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' };

const VERDICT_TONE: Record<string, string> = {
  decided: colors.success, tie: colors.warning, runoff_required: colors.warning,
  no_quorum: colors.danger, cancelled: colors.secondary, no_ballots: colors.danger,
};

const STATE_TONE: Record<string, string> = {
  open: colors.info, pending: colors.info, nominated: colors.info, draft: colors.warning,
  accepted: colors.success, cleared: colors.success, approved: colors.success,
  frozen: colors.success, active: colors.success, decided: colors.success,
  upheld: colors.success, dismissed: colors.secondary, rejected: colors.danger,
  declined: colors.danger, withdrawn: colors.secondary, removed: colors.danger,
  flagged: colors.danger, no_quorum: colors.danger, no_ballots: colors.danger,
};

export default function ElectionGovernancePanel({ estateId, electionId, onMoved }: {
  estateId: string;
  electionId: string;
  // The page's own status badge is loaded separately; tell it when a lifecycle call
  // changed the election so the two views cannot disagree about what phase we are in.
  onMoved?: (status: ElectionGovernanceState['status']) => void;
}) {
  const [outcome, setOutcome] = useState<ElectionOutcomeRow | null>(null);
  const [turnout, setTurnout] = useState<ElectionTurnoutRow | null>(null);
  const [entries, setEntries] = useState<ElectionRollEntryRow[]>([]);
  const [challenges, setChallenges] = useState<RollChallengeRow[]>([]);
  const [nominations, setNominations] = useState<NominationRow[]>([]);
  const [proposals, setProposals] = useState<RuleProposalRow[]>([]);
  const [complaints, setComplaints] = useState<ElectionComplaintRow[]>([]);
  const [recounts, setRecounts] = useState<ElectionRecountRow[]>([]);
  const [roll, setRoll] = useState<ElectionRollRow | null>(null);

  const [config, setConfig] = useState({ kind: 'binding', weighting: 'one_vote_per_unit', quorumType: 'percent', quorumValue: '30', tieBreak: 'none' });
  const [rules, setRules] = useState({ requireKyc: false, requirePayment: false, residentTypes: 'homeowner,landlord' });
  const [nominee, setNominee] = useState({ userId: '', seat: '', statement: '' });
  const [rollAction, setRollAction] = useState({ userId: '', reason: '' });
  const [text, setText] = useState({ cancel: '', complaint: '', recount: '', resolution: '' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // One aggregate read per section; a governance failure is surfaced, never swallowed.
    const [o, t, en, ch, nm, rp, cp, rc] = await Promise.all([
      getElectionOutcome(estateId, electionId), getElectionTurnout(estateId, electionId),
      listElectionRoll(estateId, electionId), listRollChallenges(estateId, electionId),
      listNominations(estateId, electionId), listElectionRuleProposals(estateId, electionId),
      listElectionComplaints(estateId, electionId), listElectionRecounts(estateId, electionId),
    ]);
    setOutcome(o); setTurnout(t); setEntries(en); setChallenges(ch); setNominations(nm);
    setProposals(rp); setComplaints(cp); setRecounts(rc);
  }, [estateId, electionId]);

  useEffect(() => {
    let alive = true;
    setError(null);
    refresh().catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [refresh]);

  // The roll id comes from a build, or — when the console opens on an election whose roll
  // was built earlier — from the entries the server just listed. Never invented here.
  const currentRollId = roll?.id ?? entries[0]?.rollId ?? '';

  const run = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fn();
      if (done) setNotice(done);
      const state = res as ElectionGovernanceState | undefined;
      if (state && typeof state === 'object' && 'status' in state && typeof state.status === 'string') {
        if (['draft', 'open', 'closed', 'tallied', 'cancelled'].includes(state.status)) onMoved?.(state.status as ElectionGovernanceState['status']);
      }
      await refresh();
    } catch (e) {
      // The Go service answers 403/409 with the reason the gate refused; that text is
      // the operator's only clue, so it is shown verbatim rather than masked.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, onMoved]);

  const types = () => rules.residentTypes.split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <Card title="Governance" style={{ marginTop: '1.25rem' }}>
      <p style={{ color: colors.muted, fontSize: '0.8rem', marginTop: 0 }}>
        Configuration, rules, roll, nominations, lifecycle, complaints and recounts. Each action is re-checked by the
        estate service — it needs the <code>estate_admin</code> role in this estate, and refuses out of sequence.
      </p>
      {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
      {notice && <p style={{ color: colors.success, fontSize: '0.85rem' }}>{notice}</p>}

      {outcome && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem', margin: '0.75rem 0' }}>
          <Fig label="Verdict" value={outcome.verdict} tone={VERDICT_TONE[outcome.verdict] ?? colors.primary} />
          <Fig label="Turnout" value={`${outcome.turnoutPercent.toFixed(1)}%`} sub={`${outcome.ballotsCast}/${outcome.ballotsAvailable} ballots`} />
          <Fig label="Quorum" value={outcome.quorumMet ? 'met' : 'not met'} sub={`${outcome.quorumType} ${outcome.quorumValue} → needs ${outcome.quorumRequired}`} tone={outcome.quorumMet ? colors.success : colors.danger} />
          <Fig label="Abstentions" value={String(outcome.abstentions)} />
          <Fig label="Voters" value={String(outcome.votersCast)} sub={`${outcome.eligibleVoters} eligible`} />
          <Fig label="Open complaints" value={String(outcome.openComplaints)} tone={outcome.openComplaints ? colors.warning : undefined} />
        </div>
      )}
      {outcome?.tieBreakNote && <p style={{ color: colors.warning, fontSize: '0.82rem', margin: '0 0 0.6rem' }}>{outcome.tieBreakNote}</p>}
      {outcome?.cancellationReason && <p style={{ color: colors.danger, fontSize: '0.82rem', margin: '0 0 0.6rem'}}>Cancelled: {outcome.cancellationReason}</p>}

      <Section title="1 — Configuration (draft only)">
        <div style={row}>
          <div style={field}>
            <span style={label}>Kind</span>
            <select style={select} value={config.kind} onChange={(e) => setConfig({ ...config, kind: e.target.value })}>
              <option value="binding">binding</option>
              <option value="poll">poll</option>
            </select>
          </div>
          <div style={field}>
            <span style={label}>Weighting</span>
            <select style={select} value={config.weighting} onChange={(e) => setConfig({ ...config, weighting: e.target.value })}>
              <option value="one_person_one_vote">one_person_one_vote</option>
              <option value="one_vote_per_unit">one_vote_per_unit</option>
            </select>
          </div>
          <div style={field}>
            <span style={label}>Quorum</span>
            <select style={select} value={config.quorumType} onChange={(e) => setConfig({ ...config, quorumType: e.target.value })}>
              <option value="none">none</option>
              <option value="count">count</option>
              <option value="percent">percent</option>
            </select>
          </div>
          <div style={field}>
            <span style={label}>Quorum value</span>
            <Input style={select} value={config.quorumValue} onChange={(e) => setConfig({ ...config, quorumValue: e.target.value })} />
          </div>
          <div style={field}>
            <span style={label}>Tie-break</span>
            <select style={select} value={config.tieBreak} onChange={(e) => setConfig({ ...config, tieBreak: e.target.value })}>
              <option value="none">none</option>
              <option value="earliest_candidate">earliest_candidate</option>
              <option value="runoff">runoff</option>
            </select>
          </div>
          <Button sm variant="primary" disabled={busy} onClick={() => void run(
            () => updateElectionConfig(estateId, electionId, {
              kind: config.kind as 'binding' | 'poll',
              weighting: config.weighting as 'one_person_one_vote' | 'one_vote_per_unit',
              quorumType: config.quorumType as 'none' | 'count' | 'percent',
              quorumValue: Number(config.quorumValue) || 0,
              tieBreak: config.tieBreak as 'none' | 'earliest_candidate' | 'runoff',
            }),
            'Configuration saved.',
          )}>Save config</Button>
        </div>
      </Section>

      <Section title="2 — Eligibility rules (proposal then approval)">
        <div style={row}>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={rules.requireKyc} onChange={(e) => setRules({ ...rules, requireKyc: e.target.checked })} /> KYC
          </label>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={rules.requirePayment} onChange={(e) => setRules({ ...rules, requirePayment: e.target.checked })} /> No outstanding dues
          </label>
          <div style={field}>
            <span style={label}>Resident types</span>
            <Input style={{ ...select, minWidth: 220 }} value={rules.residentTypes} onChange={(e) => setRules({ ...rules, residentTypes: e.target.value })} />
          </div>
          <Button sm disabled={busy} onClick={() => void run(
            () => proposeElectionRules(estateId, electionId, { requireKyc: rules.requireKyc, requirePayment: rules.requirePayment, residentTypes: types() }),
            'Rules proposed — they bind only once approved.',
          )}>Propose</Button>
        </div>
        <Table head={['State', 'KYC', 'Dues', 'Resident types', 'Proposed', '']} rows={proposals.map((p) => ({
          key: p.id,
          cells: [
            <Badge key="s" text={p.state} tone={STATE_TONE[p.state]} />,
            p.requireKyc ? 'required' : '—', p.requirePayment ? 'required' : '—',
            p.residentTypes.join(', ') || 'any', `${p.proposedBy.slice(0, 8)} · ${p.proposedAt.slice(0, 10)}`,
            p.state === 'pending' ? (
              <span key="d" style={{ display: 'flex', gap: 4 }}>
                <Button sm variant="primary" disabled={busy} onClick={() => void run(() => decideElectionRules(estateId, electionId, p.id, true, text.resolution), 'Rules approved and locked.')}>Approve</Button>
                <Button sm variant="danger" disabled={busy} onClick={() => void run(() => decideElectionRules(estateId, electionId, p.id, false, text.resolution || 'rejected'), 'Proposal rejected.')}>Reject</Button>
              </span>
            ) : <span style={{ color: colors.muted }}>{p.decisionNote ?? 'decided'}</span>,
          ],
        }))} />
      </Section>

      <Section title="3 — Voter roll (build, freeze, exceptions, challenges)">
        <div style={row}>
          <Button sm disabled={busy} onClick={() => void run(async () => { const r = await buildElectionRoll(estateId, electionId); setRoll(r); return r; }, 'Roll built as a draft version.')}>Build draft roll</Button>
          <Button sm variant="primary" disabled={busy || !currentRollId} onClick={() => void run(() => freezeElectionRoll(estateId, electionId, currentRollId), 'Roll frozen — the franchise is now published.')}>Freeze {roll ? `v${roll.version}` : 'roll'}</Button>
          <span style={{ color: colors.muted, fontSize: '0.8rem' }}>
            {roll ? `version ${roll.version} · ${roll.status} · ${roll.eligibleCount} voters / ${roll.totalBallots} ballots` : 'A frozen roll is what gates voting; a draft constrains nothing.'}
          </span>
        </div>
        <Table head={['Voter', 'Unit', 'Occupancy', 'Weight', 'Source', 'Status', '']} rows={entries.map((en) => ({
          key: `${en.rollId}:${en.userId}`,
          cells: [
            en.fullName, en.unit || '—', en.occupancyType, String(en.weight),
            <Badge key="src" text={en.source} tone={en.source === 'exception' ? colors.warning : colors.secondary} />,
            <span key="st"><Badge text={en.status} tone={STATE_TONE[en.status]} />{en.removalReason ? ` ${en.removalReason}` : ''}</span>,
            en.status === 'active' ? (
              <Button sm variant="danger" disabled={busy} onClick={() => void run(
                () => removeRollEntry(estateId, electionId, en.userId, rollAction.reason || `removed from the governance console (${en.fullName})`),
                `${en.fullName} removed with an audit trail.`,
              )}>Remove</Button>
            ) : <span style={{ color: colors.muted }}>—</span>,
          ],
        }))} />
        <div style={row}>
          <div style={field}>
            <span style={label}>User id (exception)</span>
            <Input style={{ ...select, minWidth: 220 }} value={rollAction.userId} onChange={(e) => setRollAction({ ...rollAction, userId: e.target.value })} />
          </div>
          <div style={field}>
            <span style={label}>Reason (min 5 chars)</span>
            <Input style={{ ...select, minWidth: 260 }} value={rollAction.reason} onChange={(e) => setRollAction({ ...rollAction, reason: e.target.value })} />
          </div>
          <Button sm disabled={busy || !rollAction.userId} onClick={() => void run(
            () => addRollException(estateId, electionId, rollAction.userId, rollAction.reason || 'audited roll exception'),
            'Exception added to the published roll.',
          )}>Add exception</Button>
          <Button sm variant="secondary" disabled={busy || !rollAction.userId} onClick={() => void run(
            () => challengeRollEntry(estateId, electionId, rollAction.userId, rollAction.reason || 'challenge raised from the console'),
            'Challenge filed against that entry.',
          )}>File challenge</Button>
        </div>
        <Table head={['Subject', 'Raised by', 'Reason', 'State', 'Resolution', '']} rows={challenges.map((c) => ({
          key: c.id,
          cells: [
            c.subjectName, c.raisedBy.slice(0, 8), c.reason,
            <Badge key="s" text={c.state} tone={STATE_TONE[c.state]} />,
            c.resolution ?? '—',
            c.state === 'open' ? (
              <span key="a" style={{ display: 'flex', gap: 4 }}>
                <Button sm variant="primary" disabled={busy} onClick={() => void run(() => resolveRollChallenge(estateId, electionId, c.id, true, text.resolution || 'challenge upheld'), 'Challenge upheld — entry revoked.')}>Uphold</Button>
                <Button sm disabled={busy} onClick={() => void run(() => resolveRollChallenge(estateId, electionId, c.id, false, text.resolution || 'challenge dismissed'), 'Challenge rejected.')}>Reject</Button>
              </span>
            ) : <span style={{ color: colors.muted }}>closed</span>,
          ],
        }))} />
      </Section>

      <Section title="4 — Nominations (accept, vet, certify)">
        <div style={row}>
          <div style={field}>
            <span style={label}>Nominee user id</span>
            <Input style={{ ...select, minWidth: 220 }} value={nominee.userId} onChange={(e) => setNominee({ ...nominee, userId: e.target.value })} />
          </div>
          <div style={field}>
            <span style={label}>Seat</span>
            <Input style={select} value={nominee.seat} onChange={(e) => setNominee({ ...nominee, seat: e.target.value })} />
          </div>
          <Button sm disabled={busy || !nominee.userId} onClick={() => void run(
            () => nominate(estateId, electionId, { nomineeUserId: nominee.userId, seat: nominee.seat, statement: nominee.statement }),
            'Nomination recorded.',
          )}>Nominate</Button>
        </div>
        <Table head={['Nominee', 'Seat', 'State', 'Vetting', 'Actions']} rows={nominations.map((n) => ({
          key: n.id,
          cells: [
            n.nomineeName, n.seat ?? '—',
            <Badge key="s" text={n.state} tone={STATE_TONE[n.state]} />,
            <Badge key="v" text={n.vettingState} tone={STATE_TONE[n.vettingState]} />,
            n.state === 'certified'
              ? <span style={{ color: colors.muted }}>on the ballot</span>
              : (
                <span key="a" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {n.state === 'nominated' && (
                    <>
                      <Button sm disabled={busy} onClick={() => void run(() => decideNomination(estateId, electionId, n.id, 'accept'), `${n.nomineeName} accepted.`)}>Accept</Button>
                      <Button sm variant="danger" disabled={busy} onClick={() => void run(() => decideNomination(estateId, electionId, n.id, 'decline', text.resolution || 'declined by the review panel'), `${n.nomineeName} declined.`)}>Decline</Button>
                    </>
                  )}
                  {n.vettingState === 'pending' && (
                    <Button sm disabled={busy} onClick={() => void run(() => vetNomination(estateId, electionId, n.id, true), `${n.nomineeName} vetted clear.`)}>Vet clear</Button>
                  )}
                  {n.vettingState !== 'flagged' && (
                    <Button sm variant="secondary" disabled={busy} onClick={() => void run(() => vetNomination(estateId, electionId, n.id, false, text.resolution || 'vetting flag raised'), `${n.nomineeName} flagged.`)}>Flag</Button>
                  )}
                  <Button sm variant="primary" disabled={busy || n.state !== 'accepted' || n.vettingState !== 'cleared'} onClick={() => void run(() => certifyNomination(estateId, electionId, n.id), `${n.nomineeName} certified onto the ballot.`)}>Certify</Button>
                </span>
              ),
          ],
        }))} />
      </Section>

      <Section title="5 — Lifecycle">
        <div style={row}>
          <Button sm variant="primary" disabled={busy} onClick={() => void run(() => openElection(estateId, electionId), 'Election opened for voting.')}>Open</Button>
          <Button sm disabled={busy} onClick={() => void run(() => closeElection(estateId, electionId), 'Election closed. Certify to publish the verdict.')}>Close</Button>
          <Button sm variant="secondary" disabled={busy} onClick={() => void run(() => tallyElection(estateId, electionId), 'Certified — the outcome is now published.')}>Certify (tally)</Button>
          <div style={field}>
            <span style={label}>Cancellation reason (min 5)</span>
            <Input style={{ ...select, minWidth: 260 }} value={text.cancel} onChange={(e) => setText({ ...text, cancel: e.target.value })} />
          </div>
          <Button sm variant="danger" disabled={busy || text.cancel.trim().length < 5} onClick={() => void run(() => cancelElection(estateId, electionId, text.cancel), 'Election cancelled and recorded.')}>Cancel</Button>
        </div>
        {turnout && (
          <p style={{ color: colors.muted, fontSize: '0.8rem' }}>
            Mid-poll: {turnout.ballotsCast} of {turnout.ballotsAvailable} ballots ({turnout.turnoutPercent.toFixed(1)}%),
            quorum {turnout.quorumMet ? 'met' : 'not met'} — no per-candidate figures while voting is open.
          </p>
        )}
      </Section>

      <Section title="6 — Complaints and recounts">
        <div style={row}>
          <div style={field}>
            <span style={label}>Complaint detail (min 5)</span>
            <Input style={{ ...select, minWidth: 300 }} value={text.complaint} onChange={(e) => setText({ ...text, complaint: e.target.value })} />
          </div>
          <Button sm disabled={busy || text.complaint.trim().length < 5} onClick={() => void run(() => fileElectionComplaint(estateId, electionId, 'complaint', text.complaint), 'Complaint filed.')}>File complaint</Button>
          <div style={field}>
            <span style={label}>Recount note</span>
            <Input style={{ ...select, minWidth: 220 }} value={text.recount} onChange={(e) => setText({ ...text, recount: e.target.value })} />
          </div>
          <Button sm variant="secondary" disabled={busy} onClick={() => void run(() => runElectionRecount(estateId, electionId, text.recount || 'console recount'), 'Recount re-derived from the anonymous ballots.')}>Run recount</Button>
        </div>
        <Table head={['Kind', 'Raised by', 'Detail', 'State', 'Resolution', '']} rows={complaints.map((c) => ({
          key: c.id,
          cells: [
            c.kind, c.raisedBy.slice(0, 8), c.detail,
            <Badge key="s" text={c.state} tone={STATE_TONE[c.state]} />,
            c.resolution ?? '—',
            c.state === 'open' ? (
              <span key="a" style={{ display: 'flex', gap: 4 }}>
                <Button sm variant="primary" disabled={busy} onClick={() => void run(() => resolveElectionComplaint(estateId, electionId, c.id, true, text.resolution || 'complaint upheld'), 'Complaint upheld.')}>Uphold</Button>
                <Button sm disabled={busy} onClick={() => void run(() => resolveElectionComplaint(estateId, electionId, c.id, false, text.resolution || 'complaint dismissed'), 'Complaint dismissed.')}>Dismiss</Button>
              </span>
            ) : <span style={{ color: colors.muted }}>closed</span>,
          ],
        }))} />
        {recounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recounts.map((r) => (
              <p key={r.id} style={{ fontSize: '0.82rem', margin: 0 }}>
                Recount {r.talliedAt.slice(0, 16).replace('T', ' ')}: {r.ballotsCast} ballots, {r.abstentions} abstentions —{' '}
                {r.totals.map((t) => `${t.name} ${t.votes ?? 0}`).join(' · ') || 'no candidate totals'}
                {r.note ? ` (${r.note})` : ''}
              </p>
            ))}
          </div>
        )}
      </Section>

      {outcome && outcome.results.length > 0 && (
        <Section title="Certified result">
          <Table head={['Candidate', 'Votes']} rows={outcome.results.map((c) => ({
            key: c.id,
            cells: [
              <span key="n">{outcome.winnerIds?.includes(c.id) ? <strong>{c.name}</strong> : c.name}{outcome.winnerIds?.includes(c.id) ? ' ← declared' : ''}</span>,
              String(c.votes ?? 0),
            ],
          }))} />
        </Section>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, padding: '0.75rem 0', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <h4 style={{ margin: 0, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted }}>{title}</h4>
      {children}
    </div>
  );
}

function Badge({ text, tone }: { text: string; tone?: string }) {
  return <span style={{ background: `${tone ?? colors.secondary}20`, color: tone ?? colors.secondary, padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>{text}</span>;
}

function Fig({ label: l, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.6rem 0.75rem', borderLeft: `3px solid ${tone ?? colors.primary}` }}>
      <div style={{ fontSize: '0.7rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: colors.muted }}>{sub}</div>}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  if (!rows.length) return <p style={{ color: colors.muted, fontSize: '0.82rem', margin: 0 }}>Nothing recorded yet.</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{head.map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>{r.cells.map((cell, i) => <td key={i} style={tdCell}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
