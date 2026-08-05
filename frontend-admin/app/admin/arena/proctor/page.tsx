'use client';

// A3 — Proctor console (SCAFFOLD, service wired). RBAC: arena.proctor.attest
// (Proctor, assigned batch only). Monitor active exam sessions, flag/pause/resume
// per policy, submit a session attestation → TheoryExamAdapter signs a
// merit_entry. Full live-monitoring feeds are a later build; the attest write is
// wired to the backend contract.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listContestants, proctorAttest } from '@/services/arenaAdminService';
import type { Competition, Contestant, ProctorAttestInput, MeritStage } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, StateBadge, ScaffoldNotice, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const BATCH_STAGE: Record<string, MeritStage> = { B1: 'THEORY_B1', B2: 'THEORY_B2', B3: 'THEORY_B3' };

export default function ArenaProctorPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.proctor);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<Contestant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try {
      const all = await listContestants(competitionId);
      // Proctor scope: theory-batch contestants mid-exam.
      setRows(all.filter((c) => c.theory_batch && (c.state === 'THEORY_ASSIGNED' || c.state === 'THEORY_TAKEN')));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const attest = useCallback(async (c: Contestant, attestation: ProctorAttestInput['attestation']) => {
    if (!c.theory_batch) return;
    setBusyId(c.id); setError(null); setNotice(null);
    try {
      await proctorAttest(competitionId, {
        contestant_id: c.id,
        batch: c.theory_batch,
        stage: BATCH_STAGE[c.theory_batch],
        attestation,
        note: note[c.id]?.trim() || undefined,
      });
      setNotice(`${c.full_name ?? c.id}: ${attestation} attested (adapter signs merit_entry, audited).`);
      setNote((n) => { const x = { ...n }; delete x[c.id]; return x; });
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }, [competitionId, note]);

  return (
    <Page>
      <PageHeader
        title="Arena — Proctor Console (A3)"
        subtitle="Attest theory exam sessions for your assigned batch. RBAC: arena.proctor.attest."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      <ScaffoldNotice>Live session monitoring feeds are not built yet. The attestation write (PASS / FLAG / PAUSE / RESUME) is wired to <code>POST /competitions/&#123;id&#125;/proctor/attest</code>; the adapter signs the Merit entry.</ScaffoldNotice>
      {!allowed && <PermissionBanner permission={ARENA_PERMS.proctor} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Exam sessions in scope">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading sessions…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No active theory sessions in your assigned batch.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Contestant</th>
                  <th style={thCell}>Batch</th>
                  <th style={thCell}>State</th>
                  <th style={thCell}>Note</th>
                  <th style={thCell}>Attest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.full_name ?? '—'}<div style={{ ...mono(), color: colors.muted }}>{c.user_id}</div></td>
                    <td style={tdCell}>{c.theory_batch}</td>
                    <td style={tdCell}><StateBadge state={c.state} /></td>
                    <td style={tdCell}>
                      <Input value={note[c.id] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="Optional note" style={{ minWidth: 160 }} disabled={!allowed} />
                    </td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(['PASS', 'FLAG', 'PAUSE', 'RESUME'] as const).map((a) => (
                          <Button
                            key={a}
                            variant={a === 'PASS' ? 'primary' : a === 'FLAG' ? 'danger' : 'outline'}
                            onClick={() => void attest(c, a)}
                            disabled={!allowed || busyId === c.id}
                          >
                            {a}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AuditNote>One attempt per (contestant, batch). Attestation is a signed field on the Merit entry; proctor identity is recorded. Audited.</AuditNote>
      </Card>
    </Page>
  );
}
