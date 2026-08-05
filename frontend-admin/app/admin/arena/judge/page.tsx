'use client';

// A4 — Judge console (SCAFFOLD, service wired). RBAC: arena.judge.score (Judge,
// finale + assigned contestants only). At the Lagos finale, open an assigned
// contestant and score against the published practical + crash-site/first-aid
// rubric (rubric_version pinned) → PracticalJudgeAdapter / FirstAidAdapter
// aggregate across judges (trimmed mean) and sign. Assignment routing and the
// aggregation view are a later build; the score write is wired.

import { useCallback, useEffect, useState } from 'react';
import { listCompetitions, listContestants, getCompetitionConfig, judgeScore } from '@/services/arenaAdminService';
import type { Competition, Contestant, JudgeScoreInput } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, StateBadge, ScaffoldNotice, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

export default function ArenaJudgePage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.judge);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [rows, setRows] = useState<Contestant[]>([]);
  const [rubricVersion, setRubricVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [stage, setStage] = useState<Record<string, JudgeScoreInput['stage']>>({});
  const [score, setScore] = useState<Record<string, string>>({});

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try {
      const [all, cfg] = await Promise.all([listContestants(competitionId), getCompetitionConfig(competitionId)]);
      setRubricVersion(cfg.rubric_version);
      setRows(all.filter((c) => c.state === 'FINALIST')); // finale only
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (c: Contestant) => {
    const st = stage[c.id];
    const raw = Number(score[c.id]);
    if (!st || !Number.isFinite(raw)) return;
    setBusyId(c.id); setError(null); setNotice(null);
    try {
      await judgeScore(competitionId, { contestant_id: c.id, stage: st, rubric_version: rubricVersion, raw_score: raw });
      setNotice(`${c.full_name ?? c.id}: ${st} score ${raw} submitted (rubric ${rubricVersion}; adapter aggregates + signs).`);
      setScore((s) => { const n = { ...s }; delete n[c.id]; return n; });
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }, [stage, score, competitionId, rubricVersion]);

  return (
    <Page>
      <PageHeader
        title="Arena — Judge Console (A4)"
        subtitle="Score assigned finalists on the pinned practical + first-aid rubric. RBAC: arena.judge.score."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      <ScaffoldNotice>Per-judge assignment routing and the cross-judge aggregation (trimmed mean) view are not built yet. The score write is wired to <code>POST /competitions/&#123;id&#125;/judge/score</code>; each raw score is retained for audit and the adapter signs the aggregate Merit entry.</ScaffoldNotice>
      {!allowed && <PermissionBanner permission={ARENA_PERMS.judge} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Finalists (rubric pinned)</h2>
          <span style={{ ...mono(), color: colors.muted, fontSize: '0.8rem' }}>rubric: {rubricVersion || '—'}</span>
        </div>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading finalists…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No finalists to score.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Contestant</th>
                  <th style={thCell}>State</th>
                  <th style={thCell}>Stage</th>
                  <th style={thCell}>Raw score</th>
                  <th style={thCell}>Submit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.full_name ?? '—'}<div style={{ ...mono(), color: colors.muted }}>{c.user_id}</div></td>
                    <td style={tdCell}><StateBadge state={c.state} /></td>
                    <td style={tdCell}>
                      <select value={stage[c.id] ?? ''} onChange={(e) => setStage((s) => ({ ...s, [c.id]: e.target.value as JudgeScoreInput['stage'] }))} disabled={!allowed}>
                        <option value="">Select…</option>
                        <option value="FINALE_PRACTICAL">Practical</option>
                        <option value="FINALE_FIRSTAID">First-aid</option>
                      </select>
                    </td>
                    <td style={tdCell}>
                      <Input value={score[c.id] ?? ''} onChange={(e) => setScore((s) => ({ ...s, [c.id]: e.target.value }))} placeholder="0–100" style={{ width: 90 }} disabled={!allowed} />
                    </td>
                    <td style={tdCell}>
                      <Button
                        variant="primary"
                        onClick={() => void submit(c)}
                        disabled={!allowed || !stage[c.id] || !Number.isFinite(Number(score[c.id])) || busyId === c.id}
                      >
                        {busyId === c.id ? '…' : 'Submit'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AuditNote>A judge can only score assigned contestants (enforced server-side). Each raw score is retained for audit; aggregation is deterministic.</AuditNote>
      </Card>
    </Page>
  );
}
