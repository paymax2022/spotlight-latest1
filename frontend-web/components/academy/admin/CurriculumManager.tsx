'use client';

// Author the curriculum: programmes → modules → lessons, plus assignments.
//
// A learner sees only PUBLISHED modules and lessons, so the publish toggle is on
// the create form rather than hidden behind a second step — an admin who writes a
// lesson and cannot find why nobody can see it has been failed by the UI.

import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type Program    = { id: string; title: string; batch_id: string | null; is_published: boolean };
type Module     = { id: string; program_id: string; title: string; description: string | null; order_index: number; is_published: boolean };
type Lesson     = { id: string; module_id: string; title: string; estimated_minutes: number | null; order_index: number; is_published: boolean };
type Assignment = { id: string; program_id: string | null; batch_id: string | null; title: string; due_date: string | null; max_score: number | null; status: string | null };
type Batch      = { id: string; batch_name: string };

type Tree = {
  programs: Program[]; modules: Module[]; lessons: Lesson[];
  assignments: Assignment[]; batches: Batch[];
};

const EMPTY: Tree = { programs: [], modules: [], lessons: [], assignments: [], batches: [] };

export default function CurriculumManager() {
  const [tree, setTree] = useState<Tree>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [moduleForm, setModuleForm] = useState({ program_id: '', title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ module_id: '', title: '', description: '', video_url: '', resource_url: '', resource_label: '', estimated_minutes: '30' });
  const [assignForm, setAssignForm] = useState({ program_id: '', title: '', description: '', due_date: '', max_score: '100', rubric: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/academy/curriculum', { headers: await adminAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Could not load the curriculum.'); return; }
      const d = body?.data ?? body;
      setTree({
        programs: d.programs ?? [], modules: d.modules ?? [], lessons: d.lessons ?? [],
        assignments: d.assignments ?? [], batches: d.batches ?? [],
      });
    } catch {
      setError('Could not load the curriculum.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>, onDone: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/academy/curriculum', {
        method: 'POST',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Could not save.'); return; }
      onDone();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addModule = () =>
    post(
      {
        kind: 'module',
        program_id: moduleForm.program_id,
        title: moduleForm.title,
        description: moduleForm.description,
        // Appended to the end of its programme so a new module never silently
        // reorders the ones already published.
        order_index: tree.modules.filter((m) => m.program_id === moduleForm.program_id).length,
        is_published: true,
      },
      () => setModuleForm({ program_id: moduleForm.program_id, title: '', description: '' }),
    );

  const addLesson = () =>
    post(
      {
        kind: 'lesson',
        module_id: lessonForm.module_id,
        title: lessonForm.title,
        description: lessonForm.description,
        content_markdown: '',
        video_url: lessonForm.video_url,
        resource_url: lessonForm.resource_url,
        resource_label: lessonForm.resource_label,
        order_index: tree.lessons.filter((l) => l.module_id === lessonForm.module_id).length,
        estimated_minutes: Number(lessonForm.estimated_minutes) || 0,
        is_required: true,
        is_published: true,
      },
      () => setLessonForm({ ...lessonForm, title: '', description: '', video_url: '', resource_url: '', resource_label: '' }),
    );

  const addAssignment = () =>
    post(
      {
        kind: 'assignment',
        program_id: assignForm.program_id,
        title: assignForm.title,
        description: assignForm.description,
        due_date: assignForm.due_date || null,
        max_score: Number(assignForm.max_score) || 100,
        rubric: assignForm.rubric,
        submission_format: 'link',
      },
      () => setAssignForm({ ...assignForm, title: '', description: '', due_date: '', rubric: '' }),
    );

  const input = 'w-full bg-transparent border border-foreground/20 rounded px-3 py-2 text-sm';
  const label = 'block text-xs text-foreground/50 mb-1';

  if (loading) return <p className="text-foreground/50">Loading the curriculum…</p>;

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {tree.programs.length === 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          No programmes exist yet. A programme belongs to a batch and holds the modules —
          create a batch first, then a programme, before adding lessons.
        </div>
      )}

      {/* ── existing tree ─────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-xl text-foreground mb-3">Programmes</h2>
        <div className="space-y-3">
          {tree.programs.map((p) => {
            const mods = tree.modules.filter((m) => m.program_id === p.id);
            return (
              <div key={p.id} className="rounded border border-foreground/10 p-4">
                <p className="text-foreground font-medium">{p.title}</p>
                <p className="text-xs text-foreground/40">
                  {mods.length} module{mods.length === 1 ? '' : 's'}
                  {p.is_published ? '' : ' · unpublished'}
                </p>
                <div className="mt-3 space-y-2">
                  {mods.map((m) => {
                    const ls = tree.lessons.filter((l) => l.module_id === m.id);
                    return (
                      <div key={m.id} className="pl-3 border-l border-foreground/10">
                        <p className="text-sm text-foreground/80">
                          {m.title}
                          {m.is_published ? '' : ' (draft — learners cannot see this)'}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {ls.map((l) => (
                            <li key={l.id} className="text-xs text-foreground/50">
                              · {l.title}
                              {l.estimated_minutes ? ` — ${l.estimated_minutes} min` : ''}
                              {l.is_published ? '' : ' (draft)'}
                            </li>
                          ))}
                          {ls.length === 0 && (
                            <li className="text-xs text-foreground/30">No lessons yet</li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                  {mods.length === 0 && <p className="text-xs text-foreground/30">No modules yet</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── add a module ──────────────────────────────────────────────── */}
      <section className="rounded border border-foreground/10 p-4">
        <h3 className="text-foreground font-medium mb-3">Add a module</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label>
            <span className={label}>Programme</span>
            <select value={moduleForm.program_id} onChange={(e) => setModuleForm({ ...moduleForm, program_id: e.target.value })} className={input}>
              <option value="">Choose…</option>
              {tree.programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>Title</span>
            <input value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} className={input} />
          </label>
          <label>
            <span className={label}>Description</span>
            <input value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} className={input} />
          </label>
        </div>
        <button onClick={addModule} disabled={busy || !moduleForm.program_id || !moduleForm.title.trim()} className="btn-primary py-1.5 px-4 text-sm mt-3">
          {busy ? 'Saving…' : 'Add module'}
        </button>
      </section>

      {/* ── add a lesson ──────────────────────────────────────────────── */}
      <section className="rounded border border-foreground/10 p-4">
        <h3 className="text-foreground font-medium mb-3">Add a lesson</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label>
            <span className={label}>Module</span>
            <select value={lessonForm.module_id} onChange={(e) => setLessonForm({ ...lessonForm, module_id: e.target.value })} className={input}>
              <option value="">Choose…</option>
              {tree.modules.map((m) => {
                const prog = tree.programs.find((p) => p.id === m.program_id);
                return <option key={m.id} value={m.id}>{prog ? `${prog.title} — ` : ''}{m.title}</option>;
              })}
            </select>
          </label>
          <label>
            <span className={label}>Title</span>
            <input value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} className={input} />
          </label>
          <label>
            <span className={label}>Minutes</span>
            <input type="number" min={0} value={lessonForm.estimated_minutes} onChange={(e) => setLessonForm({ ...lessonForm, estimated_minutes: e.target.value })} className={input} />
          </label>
          <label className="md:col-span-3">
            <span className={label}>Description</span>
            <input value={lessonForm.description} onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })} className={input} />
          </label>
          <label>
            <span className={label}>Video URL</span>
            <input value={lessonForm.video_url} onChange={(e) => setLessonForm({ ...lessonForm, video_url: e.target.value })} placeholder="https://…" className={input} />
          </label>
          <label>
            <span className={label}>Resource URL</span>
            <input value={lessonForm.resource_url} onChange={(e) => setLessonForm({ ...lessonForm, resource_url: e.target.value })} placeholder="https://…" className={input} />
          </label>
          <label>
            <span className={label}>Resource label</span>
            <input value={lessonForm.resource_label} onChange={(e) => setLessonForm({ ...lessonForm, resource_label: e.target.value })} placeholder="Reading list" className={input} />
          </label>
        </div>
        <button onClick={addLesson} disabled={busy || !lessonForm.module_id || !lessonForm.title.trim()} className="btn-primary py-1.5 px-4 text-sm mt-3">
          {busy ? 'Saving…' : 'Add lesson'}
        </button>
      </section>

      {/* ── add an assignment ─────────────────────────────────────────── */}
      <section className="rounded border border-foreground/10 p-4">
        <h3 className="text-foreground font-medium mb-3">Set an assignment</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label>
            <span className={label}>Programme</span>
            <select value={assignForm.program_id} onChange={(e) => setAssignForm({ ...assignForm, program_id: e.target.value })} className={input}>
              <option value="">Choose…</option>
              {tree.programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>Title</span>
            <input value={assignForm.title} onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })} className={input} />
          </label>
          <label>
            <span className={label}>Due date</span>
            <input type="date" value={assignForm.due_date} onChange={(e) => setAssignForm({ ...assignForm, due_date: e.target.value })} className={input} />
          </label>
          <label className="md:col-span-2">
            <span className={label}>Brief</span>
            <input value={assignForm.description} onChange={(e) => setAssignForm({ ...assignForm, description: e.target.value })} className={input} />
          </label>
          <label>
            <span className={label}>Max score</span>
            <input type="number" min={1} value={assignForm.max_score} onChange={(e) => setAssignForm({ ...assignForm, max_score: e.target.value })} className={input} />
          </label>
          <label className="md:col-span-3">
            <span className={label}>Rubric (shown to learners)</span>
            <input value={assignForm.rubric} onChange={(e) => setAssignForm({ ...assignForm, rubric: e.target.value })} className={input} />
          </label>
        </div>
        <button onClick={addAssignment} disabled={busy || !assignForm.program_id || !assignForm.title.trim()} className="btn-primary py-1.5 px-4 text-sm mt-3">
          {busy ? 'Saving…' : 'Set assignment'}
        </button>

        {tree.assignments.length > 0 && (
          <ul className="mt-4 space-y-1">
            {tree.assignments.map((a) => (
              <li key={a.id} className="text-xs text-foreground/50">
                · {a.title}{a.max_score ? ` — /${a.max_score}` : ''}{a.due_date ? ` — due ${a.due_date.slice(0, 10)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
