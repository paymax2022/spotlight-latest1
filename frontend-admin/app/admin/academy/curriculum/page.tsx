'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getCurriculumTree, createCurriculumVersion, getTopics, getObjectives,
  createCurriculumClass, createCurriculumSubject, createCurriculumTopic, createCurriculumObjective,
} from '@/services/academyAdminService';
import type {
  CurriculumTree, CurriculumVersionInput, CurriculumTopic, CurriculumObjective,
} from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, btn, btnPrimary, th, td, input, label, select, DisclosureNote } from '../_ui';

const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

export default function CurriculumPage() {
  const [tree, setTree] = useState<CurriculumTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [topics, setTopics] = useState<CurriculumTopic[]>([]);
  const [objectives, setObjectives] = useState<CurriculumObjective[]>([]);
  const [loadingDrill, setLoadingDrill] = useState(false);

  const [form, setForm] = useState<CurriculumVersionInput>({ name: '', effective_date: '', status: 'draft' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Quick-add forms keyed by entity.
  const [classForm, setClassForm] = useState({ name: '', order: '' });
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' });
  const [topicForm, setTopicForm] = useState({ name: '' });
  const [objForm, setObjForm] = useState<{ code: string; statement: string; bloom_level: CurriculumObjective['bloom_level'] }>({ code: '', statement: '', bloom_level: 'understand' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const t = await getCurriculumTree();
      setTree(t);
      if (t.versions[0] && !selectedVersion) setSelectedVersion(t.versions[0].id);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const classes = useMemo(() => tree?.classes.filter((c) => c.version_id === selectedVersion).sort((a, b) => a.order - b.order) ?? [], [tree, selectedVersion]);
  const subjects = useMemo(() => tree?.subjects.filter((s) => s.class_id === selectedClass) ?? [], [tree, selectedClass]);

  // Drill into topics when a subject is chosen.
  useEffect(() => {
    if (!selectedSubject) { setTopics([]); setSelectedTopic(''); return; }
    setLoadingDrill(true);
    getTopics(selectedSubject).then((t) => { setTopics(t); }).finally(() => setLoadingDrill(false));
  }, [selectedSubject]);

  // Drill into objectives when a topic is chosen.
  useEffect(() => {
    if (!selectedTopic) { setObjectives([]); return; }
    setLoadingDrill(true);
    getObjectives(selectedTopic).then(setObjectives).finally(() => setLoadingDrill(false));
  }, [selectedTopic]);

  async function submit() {
    if (!form.name || !form.effective_date) { setNotice('Name and effective date are required.'); return; }
    setSaving(true); setNotice(null);
    try {
      const v = await createCurriculumVersion(form);
      setNotice(`Created version "${v.name}" (${v.status}), effective ${v.effective_date}.`);
      setForm({ name: '', effective_date: '', status: 'draft' });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setSaving(false); }
  }

  async function addClass() {
    if (!selectedVersion || !classForm.name) { setNotice('Select a version and enter a class name.'); return; }
    setBusy(true); setNotice(null);
    try { const c = await createCurriculumClass({ version_id: selectedVersion, name: classForm.name, order: Number(classForm.order) || classes.length + 1 }); setNotice(`Added class "${c.name}".`); setClassForm({ name: '', order: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }
  async function addSubject() {
    if (!selectedClass || !subjectForm.name || !subjectForm.code) { setNotice('Select a class and enter subject name + code.'); return; }
    setBusy(true); setNotice(null);
    try { const s = await createCurriculumSubject({ class_id: selectedClass, name: subjectForm.name, code: subjectForm.code }); setNotice(`Added subject "${s.name}".`); setSubjectForm({ name: '', code: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }
  async function addTopic() {
    if (!selectedSubject || !topicForm.name) { setNotice('Select a subject and enter a topic name.'); return; }
    setBusy(true); setNotice(null);
    try { const t = await createCurriculumTopic({ subject_id: selectedSubject, name: topicForm.name }); setNotice(`Added topic "${t.name}".`); setTopicForm({ name: '' }); setTopics((prev) => [...prev, t]); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }
  async function addObjective() {
    if (!selectedTopic || !objForm.code || !objForm.statement) { setNotice('Select a topic and enter objective code + statement.'); return; }
    setBusy(true); setNotice(null);
    try { const o = await createCurriculumObjective({ topic_id: selectedTopic, code: objForm.code, statement: objForm.statement, bloom_level: objForm.bloom_level }); setNotice(`Added objective "${o.code}".`); setObjForm({ code: '', statement: '', bloom_level: 'understand' }); setObjectives((prev) => [...prev, o]); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Curriculum management" subtitle="Full versions → classes → subjects → topics → objectives, with exam-relevance alignment and effective-date rollout per entry class." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="curriculum" />
      <DisclosureNote>Requires <code>academy.curriculum</code>. The hierarchy is additive; legacy versions are retained for historical alignment, never deleted. New versions roll out on their effective date.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!tree}>
        {tree && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem', alignItems: 'start' }}>
              <Card title="Versions">
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  {tree.versions.map((v) => (
                    <button key={v.id} onClick={() => { setSelectedVersion(v.id); setSelectedClass(''); setSelectedSubject(''); setSelectedTopic(''); }} style={{ ...btn(), textAlign: 'left', borderColor: selectedVersion === v.id ? '#340075' : '#d1d5db', background: selectedVersion === v.id ? '#f5f3ff' : '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{v.name}</strong>
                        <Badge status={v.status} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.2rem' }}>Effective {v.effective_date} · {v.classes_count} classes · {v.subjects_count} subjects</div>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.6rem' }}>
                  <label style={label()}>Add class to version</label>
                  <input style={{ ...input(), marginBottom: '0.4rem' }} placeholder="Class name (e.g. SS 3)" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input style={{ ...input(), width: 80 }} type="number" placeholder="Order" value={classForm.order} onChange={(e) => setClassForm({ ...classForm, order: e.target.value })} />
                    <button onClick={addClass} disabled={busy} style={btnPrimary()}>Add</button>
                  </div>
                </div>
              </Card>

              <Card title="Classes">
                {classes.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No classes in this version yet.</p> : (
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {classes.map((c) => (
                      <button key={c.id} onClick={() => { setSelectedClass(c.id); setSelectedSubject(''); setSelectedTopic(''); }} style={{ ...btn(), textAlign: 'left', borderColor: selectedClass === c.id ? '#340075' : '#d1d5db', background: selectedClass === c.id ? '#f5f3ff' : '#fff' }}>{c.name}</button>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.6rem' }}>
                  <label style={label()}>Add subject to class</label>
                  <input style={{ ...input(), marginBottom: '0.4rem' }} placeholder="Subject name" value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input style={{ ...input(), width: 90 }} placeholder="Code" value={subjectForm.code} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })} />
                    <button onClick={addSubject} disabled={busy || !selectedClass} style={btnPrimary()}>Add</button>
                  </div>
                </div>
              </Card>

              <Card title="Subjects & topics">
                {!selectedClass ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Select a class.</p> : (
                  <>
                    <div style={{ display: 'grid', gap: '0.3rem', marginBottom: '0.6rem' }}>
                      {subjects.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No subjects.</p> : subjects.map((s) => (
                        <button key={s.id} onClick={() => { setSelectedSubject(s.id); setSelectedTopic(''); }} style={{ ...btn(), textAlign: 'left', borderColor: selectedSubject === s.id ? '#340075' : '#d1d5db', background: selectedSubject === s.id ? '#f5f3ff' : '#fff' }}>
                          <span style={{ fontSize: '0.85rem' }}>{s.name}</span> <code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{s.code}</code> <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>· {s.topics_count} topics</span>
                        </button>
                      ))}
                    </div>
                    {selectedSubject && (
                      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.5rem' }}>
                        <label style={label()}>Topics</label>
                        {loadingDrill && topics.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>Loading…</p> : (
                          <div style={{ display: 'grid', gap: '0.3rem' }}>
                            {topics.map((t) => (
                              <button key={t.id} onClick={() => setSelectedTopic(t.id)} style={{ ...btn(), textAlign: 'left', fontSize: '0.82rem', borderColor: selectedTopic === t.id ? '#340075' : '#d1d5db', background: selectedTopic === t.id ? '#f5f3ff' : '#fff' }}>{t.name} <span style={{ color: '#9ca3af' }}>· {t.objectives_count} obj</span></button>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                          <input style={input()} placeholder="New topic name" value={topicForm.name} onChange={(e) => setTopicForm({ name: e.target.value })} />
                          <button onClick={addTopic} disabled={busy} style={btnPrimary()}>Add</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Card title="Objectives & exam alignment">
                {!selectedTopic ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Select a topic to view objectives.</p> : (
                  <>
                    {loadingDrill && objectives.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>Loading…</p> : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={th()}>Code</th><th style={th()}>Objective</th><th style={th()}>Bloom</th><th style={th()}>Exam relevance</th></tr></thead>
                        <tbody>
                          {objectives.map((o) => (
                            <tr key={o.id}>
                              <td style={td()}><code style={{ fontSize: '0.75rem' }}>{o.code}</code></td>
                              <td style={td()}>{o.statement}</td>
                              <td style={td()}><Badge status={o.bloom_level === 'remember' || o.bloom_level === 'understand' ? 'open' : 'pending'} label={o.bloom_level} /></td>
                              <td style={td()}>
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                  {o.exam_relevance.length === 0 ? <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span> : o.exam_relevance.map((r) => (
                                    <span key={r.exam_code} title={r.relevance} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: '0.72rem' }}>
                                      <Badge status={r.exam_code} /><Badge status={r.relevance} />
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '0.6rem', paddingTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
                      <label style={label()}>Add objective</label>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <input style={{ ...input(), width: 110 }} placeholder="Code" value={objForm.code} onChange={(e) => setObjForm({ ...objForm, code: e.target.value })} />
                        <select style={{ ...select(), width: 130 }} value={objForm.bloom_level} onChange={(e) => setObjForm({ ...objForm, bloom_level: e.target.value as CurriculumObjective['bloom_level'] })}>
                          {BLOOM_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <input style={input()} placeholder="Objective statement" value={objForm.statement} onChange={(e) => setObjForm({ ...objForm, statement: e.target.value })} />
                        <button onClick={addObjective} disabled={busy} style={btnPrimary()}>Add</button>
                      </div>
                    </div>
                  </>
                )}
              </Card>
            </div>
          </>
        )}
      </StateBlock>

      <Card title="Create curriculum version (effective-date rollout)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div><label style={label()}>Name</label><input style={input()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. NERDC 2027" /></div>
          <div><label style={label()}>Effective date</label><input type="date" style={input()} value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} /></div>
          <div><label style={label()}>Status</label>
            <select style={select()} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CurriculumVersionInput['status'] })}>
              <option value="draft">draft</option><option value="active">active</option><option value="legacy">legacy</option>
            </select>
          </div>
          <div><button onClick={submit} disabled={saving} style={btnPrimary()}>{saving ? 'Saving…' : 'Create version'}</button></div>
        </div>
        {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
        <AuditNote>Creating or editing any curriculum entry (version/class/subject/topic/objective) is recorded to the immutable audit log.</AuditNote>
      </Card>
    </div>
  );
}
