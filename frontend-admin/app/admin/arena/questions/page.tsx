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
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  timeAgo, AuditNote, PermissionBanner, Pill, ARENA_PERMS, useArenaPermission,
} from '../_ui';

const STAGE_FILTERS: { value: '' | QuizStage; label: string }[] = [
  { value: '', label: 'All stages' },
  { value: 1, label: 'Stage 1' },
  { value: 2, label: 'Stage 2' },
  { value: 3, label: 'Stage 3' },
];

const STAGE_ACCENT: Record<QuizStage, { fg: string; bg: string }> = {
  1: { fg: '#1d4ed8', bg: '#dbeafe' },
  2: { fg: '#9a3412', bg: '#ffedd5' },
  3: { fg: '#6b21a8', bg: '#f3e8ff' },
};

function passRateColor(rate: number): { fg: string; bg: string } {
  if (rate >= 0.75) return { fg: '#15803d', bg: '#dcfce7' };
  if (rate >= 0.6) return { fg: '#9a3412', bg: '#ffedd5' };
  return { fg: '#b91c1c', bg: '#fee2e2' };
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
        const wanted = searchParams.get('competitionId');
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Quiz Bank"
        subtitle="Naija Driver safe-driving assessment: 90 questions (3 stages × 30, 120s each). Full admin teaching/QA view — answers, explanations, time limits and pass marks are shown. RBAC: arena.admin.questions."
        action={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
            <button
              onClick={() => { setConfirmImport(true); setNotice(null); }}
              style={allowed && competitionId ? btnPrimary() : btnDisabled()}
              disabled={!allowed || !competitionId}
            >
              Import quiz bank
            </button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.questions} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>
          {notice}
        </div>
      )}

      {confirmImport && (
        <Card title="Import quiz bank?" right={<button onClick={() => setConfirmImport(false)} style={btn()}>Cancel</button>}>
          <p style={{ fontSize: '0.9rem', color: '#374151', margin: '0 0 0.5rem' }}>
            This imports the <strong>{DEFAULT_QUIZ_BANK_KEY}</strong> bank (90 questions across 3 stages) into{' '}
            <strong>{competitions.find((c) => c.id === competitionId)?.name ?? competitionId}</strong>.
            {hasBank ? ' A bank is already present — importing again re-seeds it per backend policy.' : ''}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => void runImport()}
              style={allowed && !importing ? btnPrimary('#15803d') : btnDisabled()}
              disabled={!allowed || importing}
            >
              {importing ? 'Importing…' : `Import ${DEFAULT_QUIZ_BANK_KEY}`}
            </button>
            <button onClick={() => setConfirmImport(false)} style={btn()} disabled={importing}>Cancel</button>
          </div>
          <AuditNote>Importing a quiz bank writes an audit_log row (actor, bank key, rubric version, timestamp). Backend RBAC is authoritative.</AuditNote>
        </Card>
      )}

      {/* Stats header */}
      <Card title="Bank overview">
        {loading && !stats ? (
          <StatsSkeleton />
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Metric label="Total questions" value={String(stats?.totalQuestions ?? counts?.total ?? 0)} />
            {([1, 2, 3] as QuizStage[]).map((s) => {
              const perStage = stats?.perStage.find((p) => p.stage === s);
              const qc = perStage?.questionCount ?? counts?.perStage.find((p) => p.stage === s)?.count ?? 0;
              const attempts = perStage?.attemptCount ?? 0;
              const rate = perStage?.passRate ?? 0;
              const rc = passRateColor(rate);
              return (
                <div key={s} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Pill fg={STAGE_ACCENT[s].fg} bg={STAGE_ACCENT[s].bg}>Stage {s}</Pill>
                    {qc > 0 ? <Pill fg={rc.fg} bg={rc.bg}>{Math.round(rate * 100)}% pass</Pill> : <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>—</span>}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>{qc}</div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>questions · {attempts.toLocaleString()} attempts</div>
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 4 }}>{QUIZ_STAGE_LABELS[s]}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Questions table */}
      <Card
        title="Questions"
        right={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select value={String(stage)} onChange={(e) => setStage((e.target.value ? Number(e.target.value) : '') as '' | QuizStage)} style={selectStyle()}>
              {STAGE_FILTERS.map((f) => <option key={String(f.value)} value={String(f.value)}>{f.label}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle()}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search prompt / id / answer…" style={{ ...inputStyle(), minWidth: 220 }} />
          </div>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : !hasBank ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#6b7280' }}>
            <p style={{ fontSize: '0.95rem', margin: '0 0 0.75rem' }}>No quiz bank imported yet for this competition.</p>
            <button
              onClick={() => { setConfirmImport(true); setNotice(null); }}
              style={allowed && competitionId ? btnPrimary() : btnDisabled()}
              disabled={!allowed || !competitionId}
            >
              Import {DEFAULT_QUIZ_BANK_KEY}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No questions match the current filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>ID</th>
                  <th style={th()}>Stage</th>
                  <th style={th()}>Category</th>
                  <th style={th()}>Prompt</th>
                  <th style={th()}>Pass mark</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q) => {
                  const open = !!expanded[q.id];
                  return (
                    <Fragment key={q.id}>
                      <tr>
                        <td style={{ ...td(), ...mono() }}>{q.externalId}</td>
                        <td style={td()}><Pill fg={STAGE_ACCENT[q.stage].fg} bg={STAGE_ACCENT[q.stage].bg}>S{q.stage}</Pill></td>
                        <td style={td()}><Pill fg="#374151" bg="#f3f4f6">{q.category.replace(/_/g, ' ')}</Pill></td>
                        <td style={td()}>{q.prompt}</td>
                        <td style={td()}>{q.passMarkPercent}%</td>
                        <td style={td()}>
                          <button onClick={() => toggle(q.id)} style={btn()}>{open ? 'Hide' : 'Reveal answer'}</button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td style={{ ...td(), background: '#fafafa' }} colSpan={6}>
                            <div style={{ display: 'grid', gap: 6, marginBottom: '0.75rem' }}>
                              {q.options.map((opt, i) => {
                                const correct = i === q.correctIndex;
                                return (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      padding: '0.4rem 0.6rem', borderRadius: '0.375rem',
                                      border: correct ? '1px solid #86efac' : '1px solid #e5e7eb',
                                      background: correct ? '#f0fdf4' : '#fff',
                                      fontWeight: correct ? 600 : 400,
                                      color: correct ? '#166534' : '#374151', fontSize: '0.85rem',
                                    }}
                                  >
                                    <span style={{ ...mono(), color: '#9ca3af' }}>{String.fromCharCode(65 + i)}</span>
                                    <span>{opt}</span>
                                    {correct ? <Pill fg="#166534" bg="#dcfce7">correct</Pill> : null}
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
                              <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.3 }}>Explanation</div>
                              <p style={{ fontSize: '0.85rem', color: '#374151', margin: '0.25rem 0 0' }}>{q.explanation}</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem' }}>
              Showing {visible.length} of {counts?.total ?? questions.length} questions{stage ? ` · Stage ${stage}` : ''}{category ? ` · ${category.replace(/_/g, ' ')}` : ''}.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: '#374151' }}>{value}</div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem', height: 84, background: '#f9fafb' }}>
          <div style={{ width: '60%', height: 10, background: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
          <div style={{ width: '40%', height: 22, background: '#e5e7eb', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ height: 34, background: '#f3f4f6', borderRadius: 6 }} />
      ))}
    </div>
  );
}
