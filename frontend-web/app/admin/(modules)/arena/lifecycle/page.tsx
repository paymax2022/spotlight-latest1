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
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, StateBadge, LockedChip, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <Page>
      <PageHeader
        title="Arena — Lifecycle Transitions (A5)"
        subtitle="Contestants by state. Only legal transitions are offered. Advancement (QUALIFIED / FINALIST / CROWNED) reads the Merit leaderboard ONLY. RBAC: arena.admin.manage."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.info, marginBottom: '1.25rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LockedChip label="NDC-1" /> Advancement transitions are a pure function of the signed Merit ledger — no engagement or money tally is read here.
      </div>

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading contestants…</p></Card>
      ) : rows.length === 0 ? (
        <Card><p style={{ color: colors.muted }}>No contestants.</p></Card>
      ) : (
        stateOrder.filter((s) => grouped[s]?.length).map((state) => (
          <Card key={state} title={`${state.replace(/_/g, ' ')} · ${grouped[state].length}`} style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Contestant</th>
                    <th style={thCell}>Home state</th>
                    <th style={thCell}>Batch</th>
                    <th style={thCell}>Merit total</th>
                    <th style={thCell}>Updated</th>
                    <th style={thCell}>Transition to</th>
                    <th style={thCell}>Reason</th>
                    <th style={thCell}></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[state].map((c) => {
                    const legal = LEGAL_TRANSITIONS[c.state] ?? [];
                    return (
                      <tr key={c.id}>
                        <td style={tdCell}>
                          {c.full_name ?? '—'}<div style={{ ...mono(), color: colors.muted }}>{c.user_id}</div>
                        </td>
                        <td style={tdCell}>{c.home_state}</td>
                        <td style={tdCell}>{c.theory_batch ?? '—'}</td>
                        <td style={tdCell}>{c.merit_total != null ? c.merit_total.toFixed(1) : '—'}</td>
                        <td style={tdCell}>{timeAgo(c.updated_at)}</td>
                        <td style={tdCell}>
                          {legal.length === 0 ? (
                            <span style={{ color: colors.muted }}>Terminal</span>
                          ) : (
                            <select
                              value={target[c.id] ?? ''}
                              onChange={(e) => setTarget((t) => ({ ...t, [c.id]: e.target.value as ContestantState }))}
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
                        <td style={tdCell}>
                          <Input
                            value={reasons[c.id] ?? ''}
                            onChange={(e) => setReasons((r) => ({ ...r, [c.id]: e.target.value }))}
                            placeholder="Reason (required)"
                            style={{ minWidth: 180 }}
                            disabled={!allowed || legal.length === 0}
                          />
                        </td>
                        <td style={tdCell}>
                          <Button
                            variant="primary"
                            onClick={() => void submit(c)}
                            disabled={!allowed || !target[c.id] || !(reasons[c.id] ?? '').trim() || busyId === c.id}
                          >
                            {busyId === c.id ? '…' : 'Run'}
                          </Button>
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
        <p style={{ fontSize: '0.85rem', color: colors.text, margin: 0 }}>
          <StateBadge state="CROWNED" /> is atomic: crowning issues the <code>NAIJA_DRIVER</code> credential, finalizes the award with a signature, and triggers the guarded pot disbursement — all in one transaction, or none of it.
        </p>
        <AuditNote>Every transition records actor + timestamp + reason to audit_log. Only transitions in the LOCKED state machine are accepted; the backend rejects the rest (NDC-5).</AuditNote>
      </Card>
    </Page>
  );
}
