'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  listPathsAdmin, createPath, updatePath, deletePath,
  createLesson, updateLesson, deleteLesson, getPathDetail,
  listGlossary, upsertGlossary, deleteGlossary,
  type LearnPath, type Lesson, type LearnLevel, type LessonKind, type GlossaryTerm,
} from '@/services/learnAdminService';
import { PageHeader, Card, Badge, StateBlock, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../association/_ui';

const LEVELS: LearnLevel[] = ['beginner', 'stock', 'crypto', 'wealth'];
const LESSON_KINDS: LessonKind[] = ['article', 'video'];

const emptyPathForm = { id: '', title: '', description: '', iconColor: '', level: 'beginner' as LearnLevel, sortOrder: 0, published: true };
const emptyLessonForm = { id: '', pathId: '', title: '', durationMins: 5, kind: 'article' as LessonKind, body: '', summary: '', sortOrder: 0 };
const emptyGlossaryForm = { term: '', definition: '' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Learn Center content"
        subtitle="Author learning paths, lessons and glossary terms for the Paymax Invest Learn Center. Quiz answer keys are edited via the quiz JSON payload (POST/PUT /admin/quizzes)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />

      {actionError ? <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{actionError}</p> : null}

      <StateBlock loading={loading} error={error} empty={false}>
        <Card title={editingPathId ? `Edit path — ${editingPathId}` : 'Create learning path'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={label()}>Title</label>
              <input style={input()} value={pathForm.title} onChange={(e) => setPathForm({ ...pathForm, title: e.target.value })} />
            </div>
            <div>
              <label style={label()}>Level</label>
              <select style={select()} value={pathForm.level} onChange={(e) => setPathForm({ ...pathForm, level: e.target.value as LearnLevel })}>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Icon color</label>
              <input style={input()} value={pathForm.iconColor} onChange={(e) => setPathForm({ ...pathForm, iconColor: e.target.value })} placeholder="#340075" />
            </div>
            <div>
              <label style={label()}>Sort order</label>
              <input style={input()} type="number" value={pathForm.sortOrder} onChange={(e) => setPathForm({ ...pathForm, sortOrder: Number(e.target.value) })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Description</label>
              <input style={input()} value={pathForm.description} onChange={(e) => setPathForm({ ...pathForm, description: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={btnPrimary()} disabled={busy || !pathForm.title} onClick={submitPath}>{editingPathId ? 'Save path' : 'Create path'}</button>
            {editingPathId ? <button style={btn()} onClick={resetPathForm}>Cancel</button> : null}
          </div>
        </Card>

        <Card title={`Learning paths (${paths.length})`}>
          {paths.length === 0 ? <p style={{ color: '#6b7280' }}>No paths yet.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Title</th><th style={th()}>Level</th><th style={th()}>Description</th><th style={th()}>Actions</th></tr></thead>
              <tbody>
                {paths.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td style={td()}>{p.title}</td>
                      <td style={td()}><Badge status={p.level} /></td>
                      <td style={td()}>{p.description}</td>
                      <td style={td()}>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button style={btn()} onClick={() => editPath(p)}>Edit</button>
                          <button style={btn()} onClick={() => toggleLessons(p.id)}>{expandedPathId === p.id ? 'Hide lessons' : 'Lessons'}</button>
                          <button style={btn()} onClick={() => newLessonFor(p.id)}>+ Lesson</button>
                          <button style={btnDanger()} onClick={() => removePath(p.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                    {expandedPathId === p.id ? (
                      <tr>
                        <td style={td()} colSpan={4}>
                          {lessonsLoading ? <p style={{ color: '#6b7280' }}>Loading lessons…</p> : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                              {(expandedLessons ?? []).length === 0 ? <p style={{ color: '#6b7280' }}>No lessons.</p> : (expandedLessons ?? []).map((l) => (
                                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f3f4f6', borderRadius: '0.375rem', padding: '0.4rem 0.6rem' }}>
                                  <code style={{ fontSize: '0.78rem' }}>{l.id}</code>
                                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button style={btn()} onClick={() => editLesson(l)}>Edit</button>
                                    <button style={btnDanger()} onClick={() => removeLesson(l.id, p.id)}>Delete</button>
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
          )}
        </Card>

        <Card title={editingLessonId ? `Edit lesson — ${editingLessonId}` : 'Create / edit lesson'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={label()}>Path ID</label>
              <select style={select()} value={lessonForm.pathId} onChange={(e) => setLessonForm({ ...lessonForm, pathId: e.target.value })}>
                <option value="">Select a path…</option>
                {paths.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.id})</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Title</label>
              <input style={input()} value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
            </div>
            <div>
              <label style={label()}>Kind</label>
              <select style={select()} value={lessonForm.kind} onChange={(e) => setLessonForm({ ...lessonForm, kind: e.target.value as LessonKind })}>
                {LESSON_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Duration (mins)</label>
              <input style={input()} type="number" value={lessonForm.durationMins} onChange={(e) => setLessonForm({ ...lessonForm, durationMins: Number(e.target.value) })} />
            </div>
            <div>
              <label style={label()}>Sort order</label>
              <input style={input()} type="number" value={lessonForm.sortOrder} onChange={(e) => setLessonForm({ ...lessonForm, sortOrder: Number(e.target.value) })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Summary</label>
              <input style={input()} value={lessonForm.summary} onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Body</label>
              <textarea style={{ ...input(), minHeight: 100 }} value={lessonForm.body} onChange={(e) => setLessonForm({ ...lessonForm, body: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={btnPrimary()} disabled={busy || !lessonForm.title || !lessonForm.pathId} onClick={submitLesson}>{editingLessonId ? 'Save lesson' : 'Create lesson'}</button>
            {editingLessonId ? <button style={btn()} onClick={resetLessonForm}>Cancel</button> : null}
          </div>
        </Card>

        <Card title="Create / update glossary term">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={label()}>Term</label>
              <input style={input()} value={glossaryForm.term} onChange={(e) => setGlossaryForm({ ...glossaryForm, term: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={label()}>Definition</label>
              <input style={input()} value={glossaryForm.definition} onChange={(e) => setGlossaryForm({ ...glossaryForm, definition: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={btnPrimary()} disabled={busy || !glossaryForm.term || !glossaryForm.definition} onClick={submitGlossary}>Save term</button>
          </div>
        </Card>

        <Card title={`Glossary (${glossary.length})`}>
          {glossary.length === 0 ? <p style={{ color: '#6b7280' }}>No glossary terms yet.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Term</th><th style={th()}>Definition</th><th style={th()}>Actions</th></tr></thead>
              <tbody>
                {glossary.map((g) => (
                  <tr key={g.term}>
                    <td style={td()}>{g.term}</td>
                    <td style={td()}>{g.definition}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button style={btn()} onClick={() => setGlossaryForm({ term: g.term, definition: g.definition })}>Edit</button>
                        <button style={btnDanger()} onClick={() => removeGlossary(g.term)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </StateBlock>
    </div>
  );
}
