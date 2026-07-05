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
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  StateBadge, ScaffoldNotice, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Judge Console (A4)"
        subtitle="Score assigned finalists on the pinned practical + first-aid rubric. RBAC: arena.judge.score."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      <ScaffoldNotice>Per-judge assignment routing and the cross-judge aggregation (trimmed mean) view are not built yet. The score write is wired to <code>POST /competitions/&#123;id&#125;/judge/score</code>; each raw score is retained for audit and the adapter signs the aggregate Merit entry.</ScaffoldNotice>
      {!allowed && <PermissionBanner permission={ARENA_PERMS.judge} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>{notice}</div>}

      <Card title="Finalists (rubric pinned)" right={<span style={{ ...mono(), color: '#6b7280', fontSize: '0.8rem' }}>rubric: {rubricVersion || '—'}</span>}>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading finalists…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No finalists to score.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Contestant</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Stage</th>
                  <th style={th()}>Raw score</th>
                  <th style={th()}>Submit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}>{c.full_name ?? '—'}<div style={{ ...mono(), color: '#9ca3af' }}>{c.user_id}</div></td>
                    <td style={td()}><StateBadge state={c.state} /></td>
                    <td style={td()}>
                      <select value={stage[c.id] ?? ''} onChange={(e) => setStage((s) => ({ ...s, [c.id]: e.target.value as JudgeScoreInput['stage'] }))} style={selectStyle()} disabled={!allowed}>
                        <option value="">Select…</option>
                        <option value="FINALE_PRACTICAL">Practical</option>
                        <option value="FINALE_FIRSTAID">First-aid</option>
                      </select>
                    </td>
                    <td style={td()}>
                      <input value={score[c.id] ?? ''} onChange={(e) => setScore((s) => ({ ...s, [c.id]: e.target.value }))} placeholder="0–100" style={{ ...inputStyle(), width: 90 }} disabled={!allowed} />
                    </td>
                    <td style={td()}>
                      <button
                        onClick={() => void submit(c)}
                        style={allowed && stage[c.id] && Number.isFinite(Number(score[c.id])) && busyId !== c.id ? btnPrimary() : btnDisabled()}
                        disabled={!allowed || !stage[c.id] || !Number.isFinite(Number(score[c.id])) || busyId === c.id}
                      >
                        {busyId === c.id ? '…' : 'Submit'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AuditNote>A judge can only score assigned contestants (enforced server-side). Each raw score is retained for audit; aggregation is deterministic.</AuditNote>
      </Card>
    </div>
  );
}
