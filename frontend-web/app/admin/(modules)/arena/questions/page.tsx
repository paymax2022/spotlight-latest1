'use client';

// Arena — Quiz Bank (Naija Driver quiz management).
// The 90-question bank (3 stages × 30, 120s each) admins manage per competition.
// This is the FULL ADMIN / teaching-QA view: the 4 options with the correct one
// highlighted, correct_answer, explanation, time limit and pass mark are ALL
// shown here — unlike the contestant view. RBAC: arena.admin.questions.
//
// Backend contract:
//   GET  /competitions/:id/questions?stage=&category=  → { questions, counts }
//   GET  /competitions/:id/questions/stats             → { perStage, totalQuestions }
//   POST /competitions/:id/questions/import            → { imported, stages }

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  listCompetitions,
  listQuizQuestions,
  quizStats,
  importQuizBank,
  DEFAULT_QUIZ_BANK_KEY,
} from '@/services/arenaAdminService';
import type {
  Competition,
  QuizQuestion,
  QuizStage,
  QuizCounts,
  QuizStats,
} from '@/types/arenaAdmin';
import { QUIZ_STAGE_LABELS } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const STAGE_FILTERS: { value: '' | QuizStage; label: string }[] = [
  { value: '', label: 'All stages' },
  { value: 1, label: 'Stage 1' },
  { value: 2, label: 'Stage 2' },
  { value: 3, label: 'Stage 3' },
];

const STAGE_ACCENT: Record<QuizStage, string> = {
  1: colors.info,
  2: colors.warning,
  3: colors.primary,
};

function passRateColor(rate: number): string {
  if (rate >= 0.75) return colors.success;
  if (rate >= 0.6) return colors.warning;
  return colors.danger;
}

export default function ArenaQuizBankPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.questions);
  const searchParams = useSearchParams();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [counts, setCounts] = useState<QuizCounts | null>(null);
  const [stats, setStats] = useState<QuizStats | null>(null);

  const [stage, setStage] = useState<'' | QuizStage>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [importing, setImporting] = useState(false);

  // Bootstrap competitions; preselect from ?competitionId= if present.
  useEffect(() => {
    void listCompetitions()
      .then((c) => {
        setCompetitions(c);
        const wanted = searchParams?.get('competitionId') ?? null;
        const initial = (wanted && c.find((x) => x.id === wanted)?.id) || c[0]?.id || '';
        setCompetitionId(initial);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null);
    try {
      const [list, st] = await Promise.all([
        listQuizQuestions(competitionId, { stage: stage || undefined, category: category || undefined }),
        quizStats(competitionId),
      ]);
      setQuestions(list.questions);
      setCounts(list.counts);
      setStats(st);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId, stage, category]);

  useEffect(() => { void load(); }, [load]);

  const runImport = useCallback(async () => {
    if (!competitionId) return;
    setImporting(true); setError(null); setNotice(null);
    try {
      const res = await importQuizBank(competitionId, { bankKey: DEFAULT_QUIZ_BANK_KEY });
      const byStage = res.stages.map((s) => `S${s.stage}: ${s.count}`).join(' · ');
      setNotice(`Imported ${res.imported} questions (${byStage}) from ${DEFAULT_QUIZ_BANK_KEY}.`);
      setConfirmImport(false);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setImporting(false); }
  }, [competitionId, load]);

  // Categories available (from counts.perCategory so the picker persists across
  // stage filtering), plus client-side search over prompt/externalId/category.
  const categoryOptions = useMemo(() => {
    const fromCounts = counts?.perCategory?.map((c) => c.category) ?? [];
    return [...new Set(fromCounts)].sort();
  }, [counts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter((row) =>
      row.prompt.toLowerCase().includes(q) ||
      row.externalId.toLowerCase().includes(q) ||
      row.category.toLowerCase().includes(q) ||
      row.correctAnswer.toLowerCase().includes(q));
  }, [questions, search]);

  const hasBank = (stats?.totalQuestions ?? 0) > 0 || (counts?.total ?? 0) > 0;
  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  return (
    <Page>
      <PageHeader
        title="Arena — Quiz Bank"
        subtitle="Naija Driver safe-driving assessment: 90 questions (3 stages × 30, 120s each). Full admin teaching/QA view — answers, explanations, time limits and pass marks are shown. RBAC: arena.admin.questions."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
            <Button
              variant="primary"
              onClick={() => { setConfirmImport(true); setNotice(null); }}
              disabled={!allowed || !competitionId}
            >
              Import quiz bank
            </Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.questions} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && (
        <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>
          {notice}
        </div>
      )}

      {confirmImport && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Import quiz bank?</h2>
            <Button variant="outline" onClick={() => setConfirmImport(false)}>Cancel</Button>
          </div>
          <p style={{ fontSize: '0.9rem', color: colors.text, margin: '0 0 0.5rem' }}>
            This imports the <strong>{DEFAULT_QUIZ_BANK_KEY}</strong> bank (90 questions across 3 stages) into{' '}
            <strong>{competitions.find((c) => c.id === competitionId)?.name ?? competitionId}</strong>.
            {hasBank ? ' A bank is already present — importing again re-seeds it per backend policy.' : ''}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              variant="primary"
              onClick={() => void runImport()}
              disabled={!allowed || importing}
            >
              {importing ? 'Importing…' : `Import ${DEFAULT_QUIZ_BANK_KEY}`}
            </Button>
            <Button variant="outline" onClick={() => setConfirmImport(false)} disabled={importing}>Cancel</Button>
          </div>
          <AuditNote>Importing a quiz bank writes an audit_log row (actor, bank key, rubric version, timestamp). Backend RBAC is authoritative.</AuditNote>
        </Card>
      )}

      {/* Stats header */}
      <Card title="Bank overview" style={{ marginBottom: 20 }}>
        {loading && !stats ? (
          <StatsSkeleton />
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 8 }}>
            <Metric label="Total questions" value={String(stats?.totalQuestions ?? counts?.total ?? 0)} />
            {([1, 2, 3] as QuizStage[]).map((s) => {
              const perStage = stats?.perStage.find((p) => p.stage === s);
              const qc = perStage?.questionCount ?? counts?.perStage.find((p) => p.stage === s)?.count ?? 0;
              const attempts = perStage?.attemptCount ?? 0;
              const rate = perStage?.passRate ?? 0;
              const rc = passRateColor(rate);
              return (
                <div key={s} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Badge text={`Stage ${s}`} color={STAGE_ACCENT[s]} />
                    {qc > 0 ? <Badge text={`${Math.round(rate * 100)}% pass`} color={rc} /> : <span style={{ color: colors.muted, fontSize: '0.72rem' }}>—</span>}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: colors.text }}>{qc}</div>
                  <div style={{ fontSize: '0.72rem', color: colors.muted }}>questions · {attempts.toLocaleString()} attempts</div>
                  <div style={{ fontSize: '0.7rem', color: colors.muted, marginTop: 4 }}>{QUIZ_STAGE_LABELS[s]}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Questions table */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Questions</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select value={String(stage)} onChange={(e) => setStage((e.target.value ? Number(e.target.value) : '') as '' | QuizStage)}>
              {STAGE_FILTERS.map((f) => <option key={String(f.value)} value={String(f.value)}>{f.label}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search prompt / id / answer…" style={{ minWidth: 220 }} />
          </div>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : !hasBank ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: colors.muted }}>
            <p style={{ fontSize: '0.95rem', margin: '0 0 0.75rem' }}>No quiz bank imported yet for this competition.</p>
            <Button
              variant="primary"
              onClick={() => { setConfirmImport(true); setNotice(null); }}
              disabled={!allowed || !competitionId}
            >
              Import {DEFAULT_QUIZ_BANK_KEY}
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <p style={{ color: colors.muted }}>No questions match the current filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>ID</th>
                  <th style={thCell}>Stage</th>
                  <th style={thCell}>Category</th>
                  <th style={thCell}>Prompt</th>
                  <th style={thCell}>Pass mark</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q) => {
                  const open = !!expanded[q.id];
                  return (
                    <Fragment key={q.id}>
                      <tr>
                        <td style={{ ...tdCell, ...mono() }}>{q.externalId}</td>
                        <td style={tdCell}><Badge text={`S${q.stage}`} color={STAGE_ACCENT[q.stage]} /></td>
                        <td style={tdCell}><Badge text={q.category.replace(/_/g, ' ')} color={colors.secondary} /></td>
                        <td style={tdCell}>{q.prompt}</td>
                        <td style={tdCell}>{q.passMarkPercent}%</td>
                        <td style={tdCell}>
                          <Button variant="outline" onClick={() => toggle(q.id)}>{open ? 'Hide' : 'Reveal answer'}</Button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td style={{ ...tdCell, background: colors.headBg }} colSpan={6}>
                            {q.imageUrl ? (
                              <div style={{ marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Illustration</div>
                                {q.imageUrl.startsWith('sign:') ? (
                                  <Badge text={`Sign: ${q.imageUrl.slice('sign:'.length)}`} color={colors.info} />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={q.imageUrl} alt="Question illustration" style={{ maxWidth: 220, maxHeight: 160, borderRadius: '0.5rem', border: `1px solid ${colors.border}`, objectFit: 'contain', background: colors.card }} />
                                )}
                              </div>
                            ) : null}
                            <div style={{ display: 'grid', gap: 6, marginBottom: '0.75rem' }}>
                              {q.options.map((opt, i) => {
                                const correct = i === q.correctIndex;
                                return (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      padding: '0.4rem 0.6rem', borderRadius: '0.375rem',
                                      border: correct ? `1px solid ${tint(colors.success, 0.5)}` : `1px solid ${colors.border}`,
                                      background: correct ? tint(colors.success, 0.12) : colors.card,
                                      fontWeight: correct ? 600 : 400,
                                      color: correct ? colors.success : colors.text, fontSize: '0.85rem',
                                    }}
                                  >
                                    <span style={{ ...mono(), color: colors.muted }}>{String.fromCharCode(65 + i)}</span>
                                    <span>{opt}</span>
                                    {correct ? <Badge text="correct" color={colors.success} /> : null}
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '0.5rem' }}>
                              <DetailField label="Correct answer" value={q.correctAnswer} />
                              <DetailField label="Time limit" value={`${q.timeLimitSeconds}s`} />
                              <DetailField label="Pass mark" value={`${q.passMarkPercent}%`} />
                              <DetailField label="Stage" value={QUIZ_STAGE_LABELS[q.stage]} />
                            </div>
                            <div>
                              <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>Explanation</div>
                              <p style={{ fontSize: '0.85rem', color: colors.text, margin: '0.25rem 0 0' }}>{q.explanation}</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.75rem' }}>
              Showing {visible.length} of {counts?.total ?? questions.length} questions{stage ? ` · Stage ${stage}` : ''}{category ? ` · ${category.replace(/_/g, ' ')}` : ''}.
            </p>
          </div>
        )}
      </Card>
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: colors.text }}>{value}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: colors.text }}>{value}</div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem', height: 84, background: colors.headBg }}>
          <div style={{ width: '60%', height: 10, background: colors.border, borderRadius: 4, marginBottom: 12 }} />
          <div style={{ width: '40%', height: 22, background: colors.border, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ height: 34, background: colors.headBg, borderRadius: 6 }} />
      ))}
    </div>
  );
}
