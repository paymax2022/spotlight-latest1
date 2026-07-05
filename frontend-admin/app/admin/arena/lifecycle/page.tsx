'use client';

// A5 — Lifecycle transition console. RBAC: arena.admin.manage (Competition Admin).
// Contestants grouped by state; run guarded transitions per the LOCKED state
// machine (ARENA-PRD §8). Only legal `to` states are offered — the backend
// rejects anything else (NDC-5). Advancement (QUALIFIED/FINALIST/CROWNED) is
// computed from the Merit leaderboard ONLY — never money/engagement (NDC-1).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompetitions, listContestants, runTransition } from '@/services/arenaAdminService';
import type { Competition, Contestant, ContestantState } from '@/types/arenaAdmin';
import { LEGAL_TRANSITIONS, MERIT_DERIVED_TRANSITIONS } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  StateBadge, LockedChip, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

export default function ArenaLifecyclePage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<Contestant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // per-contestant transition draft
  const [target, setTarget] = useState<Record<string, ContestantState>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try { setRows(await listContestants(competitionId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const g: Record<string, Contestant[]> = {};
    for (const c of rows) (g[c.state] ??= []).push(c);
    return g;
  }, [rows]);

  const submit = useCallback(async (c: Contestant) => {
    const to = target[c.id];
    const reason = (reasons[c.id] ?? '').trim();
    if (!to || !reason) return;
    setBusyId(c.id); setError(null); setNotice(null);
    try {
      await runTransition(competitionId, c.id, to, reason);
      setNotice(`${c.full_name ?? c.id}: ${c.state} → ${to} (guarded, atomic side-effects, audited).`);
      setTarget((t) => { const n = { ...t }; delete n[c.id]; return n; });
      setReasons((r) => { const n = { ...r }; delete n[c.id]; return n; });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }, [target, reasons, competitionId, load]);

  const stateOrder: ContestantState[] = ['APPLIED', 'SCREENED', 'TRAINED', 'THEORY_ASSIGNED', 'THEORY_TAKEN', 'QUALIFIED', 'FINALIST', 'CROWNED', 'ELIMINATED', 'REJECTED', 'WITHDRAWN'];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Lifecycle Transitions (A5)"
        subtitle="Contestants by state. Only legal transitions are offered. Advancement (QUALIFIED / FINALIST / CROWNED) reads the Merit leaderboard ONLY. RBAC: arena.admin.manage."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>{notice}</div>}

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#1e40af', marginBottom: '1.25rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LockedChip label="NDC-1" /> Advancement transitions are a pure function of the signed Merit ledger — no engagement or money tally is read here.
      </div>

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading contestants…</p></Card>
      ) : rows.length === 0 ? (
        <Card><p style={{ color: '#6b7280' }}>No contestants.</p></Card>
      ) : (
        stateOrder.filter((s) => grouped[s]?.length).map((state) => (
          <Card key={state} title={`${state.replace(/_/g, ' ')} · ${grouped[state].length}`}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Contestant</th>
                    <th style={th()}>Home state</th>
                    <th style={th()}>Batch</th>
                    <th style={th()}>Merit total</th>
                    <th style={th()}>Updated</th>
                    <th style={th()}>Transition to</th>
                    <th style={th()}>Reason</th>
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[state].map((c) => {
                    const legal = LEGAL_TRANSITIONS[c.state] ?? [];
                    return (
                      <tr key={c.id}>
                        <td style={td()}>
                          {c.full_name ?? '—'}<div style={{ ...mono(), color: '#9ca3af' }}>{c.user_id}</div>
                        </td>
                        <td style={td()}>{c.home_state}</td>
                        <td style={td()}>{c.theory_batch ?? '—'}</td>
                        <td style={td()}>{c.merit_total != null ? c.merit_total.toFixed(1) : '—'}</td>
                        <td style={td()}>{timeAgo(c.updated_at)}</td>
                        <td style={td()}>
                          {legal.length === 0 ? (
                            <span style={{ color: '#9ca3af' }}>Terminal</span>
                          ) : (
                            <select
                              value={target[c.id] ?? ''}
                              onChange={(e) => setTarget((t) => ({ ...t, [c.id]: e.target.value as ContestantState }))}
                              style={selectStyle()}
                              disabled={!allowed}
                            >
                              <option value="">Select…</option>
                              {legal.map((to) => (
                                <option key={to} value={to}>
                                  {to.replace(/_/g, ' ')}{MERIT_DERIVED_TRANSITIONS.includes(to) ? ' (Merit)' : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={td()}>
                          <input
                            value={reasons[c.id] ?? ''}
                            onChange={(e) => setReasons((r) => ({ ...r, [c.id]: e.target.value }))}
                            placeholder="Reason (required)"
                            style={{ ...inputStyle(), minWidth: 180 }}
                            disabled={!allowed || legal.length === 0}
                          />
                        </td>
                        <td style={td()}>
                          <button
                            onClick={() => void submit(c)}
                            style={allowed && target[c.id] && (reasons[c.id] ?? '').trim() && busyId !== c.id ? btnPrimary() : btnDisabled()}
                            disabled={!allowed || !target[c.id] || !(reasons[c.id] ?? '').trim() || busyId === c.id}
                          >
                            {busyId === c.id ? '…' : 'Run'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Card>
        <p style={{ fontSize: '0.85rem', color: '#374151', margin: 0 }}>
          <StateBadge state="CROWNED" /> is atomic: crowning issues the <code>NAIJA_DRIVER</code> credential, finalizes the award with a signature, and triggers the guarded pot disbursement — all in one transaction, or none of it.
        </p>
        <AuditNote>Every transition records actor + timestamp + reason to audit_log. Only transitions in the LOCKED state machine are accepted; the backend rejects the rest (NDC-5).</AuditNote>
      </Card>
    </div>
  );
}
