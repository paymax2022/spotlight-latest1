'use client';

import { useEffect, useState } from 'react';
import { listExamArenas, listExamBlueprints, listSubjectCombinations, createExamBlueprint } from '@/services/academyAdminService';
import type { ExamArena, ExamBlueprint, SubjectCombinationRule, ExamBlueprintInput } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, th, td, input, label, select, pct } from '../_ui';
import { colors } from '@/components/ui/vuexy';

function countdown(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}

const EMPTY: ExamBlueprintInput = { arena_id: '', name: '', duration_minutes: 60, question_count: 50, pass_mark_pct: 0.5, negative_marking: false, subjects: [] };

export default function ExamsPage() {
  const [arenas, setArenas] = useState<ExamArena[]>([]);
  const [blueprints, setBlueprints] = useState<ExamBlueprint[]>([]);
  const [combos, setCombos] = useState<SubjectCombinationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ExamBlueprintInput>({ ...EMPTY });
  const [subjectsRaw, setSubjectsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [a, b, c] = await Promise.all([listExamArenas(), listExamBlueprints(), listSubjectCombinations()]);
      setArenas(a); setBlueprints(b); setCombos(c);
      if (a[0] && !form.arena_id) setForm((f) => ({ ...f, arena_id: a[0].id }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    const subjects = subjectsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!form.arena_id || !form.name || subjects.length === 0) { setNotice('Arena, name and at least one subject are required.'); return; }
    setSaving(true); setNotice(null);
    try {
      await createExamBlueprint({ ...form, subjects });
      setNotice('Blueprint created.');
      setForm({ ...EMPTY, arena_id: form.arena_id }); setSubjectsRaw('');
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Exam arena management" subtitle="Configure each exam (CCE/BECE/WASSCE/NECO/UTME/NABTEB); CBT blueprints; scoring rules; calendars & countdowns; UTME subject-combination requirements engine." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="exams" />
      <DisclosureNote>Requires <code>academy.exam</code>. Blueprints draw only from approved question-bank items. Scoring rules (pass mark, negative marking) are versioned per blueprint.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={arenas.length === 0}>
        <Card title="Exam arenas">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Exam</th><th style={th()}>Arena</th><th style={th()}>Status</th><th style={th()}>Next session</th><th style={th()}>Countdown</th><th style={th()}>Registered</th></tr></thead>
            <tbody>
              {arenas.map((a) => (
                <tr key={a.id}>
                  <td style={td()}><Badge status={a.exam_code} /></td>
                  <td style={td()}>{a.name}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={td()}>{a.next_session_at ?? '—'}</td>
                  <td style={td()}><strong>{countdown(a.next_session_at)}</strong></td>
                  <td style={td()}>{a.registered.toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="CBT blueprints & scoring rules">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Blueprint</th><th style={th()}>Arena</th><th style={th()}>Duration</th><th style={th()}>Questions</th><th style={th()}>Pass mark</th><th style={th()}>Neg. marking</th><th style={th()}>Subjects</th></tr></thead>
            <tbody>
              {blueprints.map((b) => (
                <tr key={b.id}>
                  <td style={td()}>{b.name}</td>
                  <td style={td()}>{arenas.find((a) => a.id === b.arena_id)?.name ?? b.arena_id}</td>
                  <td style={td()}>{b.duration_minutes} min</td>
                  <td style={td()}>{b.question_count}</td>
                  <td style={td()}>{pct(b.pass_mark_pct)}</td>
                  <td style={td()}>{b.negative_marking ? 'Yes' : 'No'}</td>
                  <td style={td()}>{b.subjects.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Subject-combination rules (UTME)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Course</th><th style={th()}>Required</th><th style={th()}>Electives</th></tr></thead>
            <tbody>
              {combos.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>{c.course}</td>
                  <td style={td()}>{c.required_subjects.join(', ')}</td>
                  <td style={td()}>{c.electives_pick > 0 ? `pick ${c.electives_pick} of: ${c.elective_pool.join(', ')}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>

      <Card title="Create blueprint">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
          <div><label style={label()}>Arena</label>
            <select style={select()} value={form.arena_id} onChange={(e) => setForm({ ...form, arena_id: e.target.value })}>
              {arenas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div><label style={label()}>Name</label><input style={input()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label style={label()}>Duration (min)</label><input type="number" style={input()} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
          <div><label style={label()}>Questions</label><input type="number" style={input()} value={form.question_count} onChange={(e) => setForm({ ...form, question_count: Number(e.target.value) })} /></div>
          <div><label style={label()}>Pass mark (%)</label><input type="number" style={input()} value={Math.round(form.pass_mark_pct * 100)} onChange={(e) => setForm({ ...form, pass_mark_pct: Number(e.target.value) / 100 })} /></div>
          <div><label style={label()}>Subjects (comma-sep)</label><input style={input()} value={subjectsRaw} onChange={(e) => setSubjectsRaw(e.target.value)} placeholder="English, Mathematics" /></div>
          <div><label style={label()}>Negative marking</label>
            <select style={select()} value={form.negative_marking ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, negative_marking: e.target.value === 'yes' })}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </div>
          <div><button onClick={submit} disabled={saving} style={btnPrimary()}>{saving ? 'Saving…' : 'Create blueprint'}</button></div>
        </div>
        {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.6rem' }}>{notice}</p>}
        <AuditNote>Blueprint and scoring-rule changes are recorded to the immutable audit log.</AuditNote>
      </Card>
    </div>
  );
}
