'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  listPathsAdmin, createPath, updatePath, deletePath,
  createLesson, updateLesson, deleteLesson, getPathDetail,
  listGlossary, upsertGlossary, deleteGlossary,
  type LearnPath, type Lesson, type LearnLevel, type LessonKind, type GlossaryTerm,
} from '@/services/learnAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const LEVELS: LearnLevel[] = ['beginner', 'stock', 'crypto', 'wealth'];
const LESSON_KINDS: LessonKind[] = ['article', 'video'];

const LEVEL_COLOR: Record<LearnLevel, string> = {
  beginner: colors.success,
  stock: colors.info,
  crypto: colors.warning,
  wealth: colors.primary,
};

const emptyPathForm = { id: '', title: '', description: '', iconColor: '', level: 'beginner' as LearnLevel, sortOrder: 0, published: true };
const emptyLessonForm = { id: '', pathId: '', title: '', durationMins: 5, kind: 'article' as LessonKind, body: '', summary: '', sortOrder: 0 };
const emptyGlossaryForm = { term: '', definition: '' };

function fieldLabel(): React.CSSProperties {
  return { display: 'block', fontSize: '0.78rem', color: colors.muted, marginBottom: '0.25rem', fontWeight: 600 };
}

export default function LearnAdminPage() {
  const [paths, setPaths] = useState<LearnPath[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pathForm, setPathForm] = useState(emptyPathForm);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);

  const [lessonForm, setLessonForm] = useState(emptyLessonForm);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null);
  const [expandedLessons, setExpandedLessons] = useState<Lesson[] | null>(null);
  const [lessonsLoading, setLessonsLoading] = useState(false);

  const [glossaryForm, setGlossaryForm] = useState(emptyGlossaryForm);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, g] = await Promise.all([listPathsAdmin(), listGlossary()]);
      setPaths(p); setGlossary(g);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // ── Paths ───────────────────────────────────────────────────────────────
  function editPath(p: LearnPath) {
    setEditingPathId(p.id);
    setPathForm({ id: p.id, title: p.title, description: p.description, iconColor: p.iconColor, level: p.level, sortOrder: 0, published: true });
  }
  function resetPathForm() { setEditingPathId(null); setPathForm(emptyPathForm); }

  async function submitPath() {
    setBusy(true); setActionError(null);
    try {
      const input = {
        id: pathForm.id || undefined,
        title: pathForm.title,
        description: pathForm.description,
        iconColor: pathForm.iconColor,
        level: pathForm.level,
        sortOrder: pathForm.sortOrder,
        published: pathForm.published,
      };
      if (editingPathId) await updatePath(editingPathId, input);
      else await createPath(input);
      resetPathForm();
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function removePath(id: string) {
    if (!confirm(`Delete path ${id}? This cannot be undone.`)) return;
    setBusy(true); setActionError(null);
    try { await deletePath(id); await load(); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function refreshLessons(pathId: string) {
    setLessonsLoading(true); setExpandedLessons(null);
    try {
      const detail = await getPathDetail(pathId);
      // getPathDetail returns lessonIds only; fetch each lesson individually
      // is unnecessary for admin authoring — the lesson form below lets an
      // admin create/edit lessons directly by pathId without needing full
      // lesson bodies rendered inline.
      setExpandedLessons(detail.lessonIds.map((id) => ({ id, pathId, title: id, durationMins: 0, kind: 'article', body: '', summary: '' })));
    } catch (e) { setActionError(String(e)); }
    finally { setLessonsLoading(false); }
  }

  async function toggleLessons(pathId: string) {
    if (expandedPathId === pathId) { setExpandedPathId(null); setExpandedLessons(null); return; }
    setExpandedPathId(pathId);
    await refreshLessons(pathId);
  }

  // ── Lessons ─────────────────────────────────────────────────────────────
  function newLessonFor(pathId: string) {
    setEditingLessonId(null);
    setLessonForm({ ...emptyLessonForm, pathId });
  }
  function editLesson(l: Lesson) {
    setEditingLessonId(l.id);
    setLessonForm({ id: l.id, pathId: l.pathId, title: l.title, durationMins: l.durationMins, kind: l.kind, body: l.body, summary: l.summary, sortOrder: 0 });
  }
  function resetLessonForm() { setEditingLessonId(null); setLessonForm(emptyLessonForm); }

  async function submitLesson() {
    setBusy(true); setActionError(null);
    try {
      const input = {
        id: lessonForm.id || undefined,
        pathId: lessonForm.pathId,
        title: lessonForm.title,
        durationMins: lessonForm.durationMins,
        kind: lessonForm.kind,
        body: lessonForm.body,
        summary: lessonForm.summary,
        sortOrder: lessonForm.sortOrder,
      };
      if (editingLessonId) await updateLesson(editingLessonId, input);
      else await createLesson(input);
      resetLessonForm();
      if (expandedPathId) await refreshLessons(expandedPathId);
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function removeLesson(id: string, pathId: string) {
    if (!confirm(`Delete lesson ${id}?`)) return;
    setBusy(true); setActionError(null);
    try {
      await deleteLesson(id);
      setExpandedPathId(pathId);
      await refreshLessons(pathId);
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  // ── Glossary ────────────────────────────────────────────────────────────
  async function submitGlossary() {
    setBusy(true); setActionError(null);
    try {
      await upsertGlossary(glossaryForm);
      setGlossaryForm(emptyGlossaryForm);
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }
  async function removeGlossary(term: string) {
    if (!confirm(`Delete glossary term "${term}"?`)) return;
    setBusy(true); setActionError(null);
    try { await deleteGlossary(term); await load(); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        title="Learn Center content"
        subtitle="Author learning paths, lessons and glossary terms for the Paymax Invest Learn Center. Quiz answer keys are edited via the quiz JSON payload (POST/PUT /admin/quizzes)."
        actions={<Button onClick={load}>Refresh</Button>}
      />

      {actionError ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{actionError}</p> : null}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : (
        <>
          <Card title={editingPathId ? `Edit path — ${editingPathId}` : 'Create learning path'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Title</label>
                <Input value={pathForm.title} onChange={(e) => setPathForm({ ...pathForm, title: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Level</label>
                <select style={{ width: '100%' }} value={pathForm.level} onChange={(e) => setPathForm({ ...pathForm, level: e.target.value as LearnLevel })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Icon color</label>
                <Input value={pathForm.iconColor} onChange={(e) => setPathForm({ ...pathForm, iconColor: e.target.value })} placeholder="#340075" />
              </div>
              <div>
                <label style={fieldLabel()}>Sort order</label>
                <Input type="number" value={pathForm.sortOrder} onChange={(e) => setPathForm({ ...pathForm, sortOrder: Number(e.target.value) })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Description</label>
                <Input value={pathForm.description} onChange={(e) => setPathForm({ ...pathForm, description: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !pathForm.title} onClick={submitPath}>{editingPathId ? 'Save path' : 'Create path'}</Button>
              {editingPathId ? <Button onClick={resetPathForm}>Cancel</Button> : null}
            </div>
          </Card>

          <Card title={`Learning paths (${paths.length})`} style={{ marginBottom: '1.25rem' }}>
            {paths.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No paths yet.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Title</th><th style={thCell}>Level</th><th style={thCell}>Description</th><th style={thCell}>Actions</th></tr></thead>
                  <tbody>
                    {paths.map((p) => (
                      <Fragment key={p.id}>
                        <tr>
                          <td style={tdCell}>{p.title}</td>
                          <td style={tdCell}><Badge text={p.level} color={LEVEL_COLOR[p.level] ?? colors.secondary} /></td>
                          <td style={tdCell}>{p.description}</td>
                          <td style={tdCell}>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <Button sm onClick={() => editPath(p)}>Edit</Button>
                              <Button sm onClick={() => toggleLessons(p.id)}>{expandedPathId === p.id ? 'Hide lessons' : 'Lessons'}</Button>
                              <Button sm onClick={() => newLessonFor(p.id)}>+ Lesson</Button>
                              <Button sm variant="danger" onClick={() => removePath(p.id)}>Delete</Button>
                            </div>
                          </td>
                        </tr>
                        {expandedPathId === p.id ? (
                          <tr>
                            <td style={tdCell} colSpan={4}>
                              {lessonsLoading ? <p style={{ color: colors.muted }}>Loading lessons…</p> : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                  {(expandedLessons ?? []).length === 0 ? <p style={{ color: colors.muted }}>No lessons.</p> : (expandedLessons ?? []).map((l) => (
                                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.4rem 0.6rem' }}>
                                      <code style={{ fontSize: '0.78rem' }}>{l.id}</code>
                                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <Button sm onClick={() => editLesson(l)}>Edit</Button>
                                        <Button sm variant="danger" onClick={() => removeLesson(l.id, p.id)}>Delete</Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={editingLessonId ? `Edit lesson — ${editingLessonId}` : 'Create / edit lesson'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Path ID</label>
                <select style={{ width: '100%' }} value={lessonForm.pathId} onChange={(e) => setLessonForm({ ...lessonForm, pathId: e.target.value })}>
                  <option value="">Select a path…</option>
                  {paths.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.id})</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Title</label>
                <Input value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Kind</label>
                <select style={{ width: '100%' }} value={lessonForm.kind} onChange={(e) => setLessonForm({ ...lessonForm, kind: e.target.value as LessonKind })}>
                  {LESSON_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Duration (mins)</label>
                <Input type="number" value={lessonForm.durationMins} onChange={(e) => setLessonForm({ ...lessonForm, durationMins: Number(e.target.value) })} />
              </div>
              <div>
                <label style={fieldLabel()}>Sort order</label>
                <Input type="number" value={lessonForm.sortOrder} onChange={(e) => setLessonForm({ ...lessonForm, sortOrder: Number(e.target.value) })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Summary</label>
                <Input value={lessonForm.summary} onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Body</label>
                <textarea style={{ minHeight: 100, width: '100%' }} value={lessonForm.body} onChange={(e) => setLessonForm({ ...lessonForm, body: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !lessonForm.title || !lessonForm.pathId} onClick={submitLesson}>{editingLessonId ? 'Save lesson' : 'Create lesson'}</Button>
              {editingLessonId ? <Button onClick={resetLessonForm}>Cancel</Button> : null}
            </div>
          </Card>

          <Card title="Create / update glossary term" style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Term</label>
                <Input value={glossaryForm.term} onChange={(e) => setGlossaryForm({ ...glossaryForm, term: e.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Definition</label>
                <Input value={glossaryForm.definition} onChange={(e) => setGlossaryForm({ ...glossaryForm, definition: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !glossaryForm.term || !glossaryForm.definition} onClick={submitGlossary}>Save term</Button>
            </div>
          </Card>

          <Card title={`Glossary (${glossary.length})`}>
            {glossary.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No glossary terms yet.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Term</th><th style={thCell}>Definition</th><th style={thCell}>Actions</th></tr></thead>
                  <tbody>
                    {glossary.map((g) => (
                      <tr key={g.term}>
                        <td style={tdCell}>{g.term}</td>
                        <td style={tdCell}>{g.definition}</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <Button sm onClick={() => setGlossaryForm({ term: g.term, definition: g.definition })}>Edit</Button>
                            <Button sm variant="danger" onClick={() => removeGlossary(g.term)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
