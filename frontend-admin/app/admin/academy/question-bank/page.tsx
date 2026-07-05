'use client';

import { useEffect, useState } from 'react';
import { listQuestionItems, createQuestionItem, reviewQuestionItem } from '@/services/academyAdminService';
import type { QuestionItem, QuestionItemInput, QuestionReviewInput } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, btnDanger, th, td, input, label, select, FilterBar } from '../_ui';

const EMPTY: QuestionItemInput = { stem: '', type: 'mcq', subject: '', topic: '', difficulty: 'medium', objective: '', options: ['', '', '', ''], answer_key: '' };

export default function QuestionBankPage() {
  const [items, setItems] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [form, setForm] = useState<QuestionItemInput>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await listQuestionItems()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'all' ? items : items.filter((i) => i.review_status === statusFilter);

  async function submit() {
    if (!form.stem || !form.subject || !form.answer_key) { setNotice('Stem, subject and answer key are required.'); return; }
    setSaving(true); setNotice(null);
    try {
      await createQuestionItem({ ...form, options: form.options.filter((o) => o.trim()) });
      setNotice('Item created in draft and queued for review.');
      setForm({ ...EMPTY, options: ['', '', '', ''] });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setSaving(false); }
  }

  async function review(id: string, action: QuestionReviewInput['action']) {
    try { await reviewQuestionItem(id, { action }); await load(); }
    catch (e) { setNotice(String(e)); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Question bank" subtitle="Item authoring (MCQ + rich types); tag by subject/topic/difficulty/objective; review workflow; duplicate detection; item analysis (difficulty, discrimination)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="question-bank" />
      <DisclosureNote>Requires <code>academy.assessment</code>. Items enter as drafts and must pass review before they are eligible for blueprints. Suspected duplicates are flagged, not deleted.</DisclosureNote>

      <Card title="Author new item">
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div><label style={label()}>Stem (question text)</label><input style={input()} value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} placeholder="Enter the question…" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
            <div><label style={label()}>Type</label>
              <select style={select()} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as QuestionItemInput['type'] })}>
                <option value="mcq">MCQ</option><option value="multi_select">Multi-select</option><option value="numeric">Numeric</option><option value="short_text">Short text</option>
              </select>
            </div>
            <div><label style={label()}>Subject</label><input style={input()} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Physics" /></div>
            <div><label style={label()}>Topic</label><input style={input()} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Motion" /></div>
            <div><label style={label()}>Difficulty</label>
              <select style={select()} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as QuestionItemInput['difficulty'] })}>
                <option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option>
              </select>
            </div>
            <div><label style={label()}>Objective</label><input style={input()} value={form.objective ?? ''} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Optional" /></div>
          </div>
          {(form.type === 'mcq' || form.type === 'multi_select') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem' }}>
              {form.options.map((opt, idx) => (
                <div key={idx}><label style={label()}>Option {idx + 1}</label><input style={input()} value={opt} onChange={(e) => { const next = [...form.options]; next[idx] = e.target.value; setForm({ ...form, options: next }); }} /></div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Answer key</label><input style={input()} value={form.answer_key} onChange={(e) => setForm({ ...form, answer_key: e.target.value })} placeholder="Correct answer (comma-separate for multi-select)" /></div>
            <button onClick={submit} disabled={saving} style={btnPrimary()}>{saving ? 'Saving…' : 'Create item'}</button>
          </div>
        </div>
        {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
        <AuditNote>Authoring and review decisions are recorded to the immutable audit log.</AuditNote>
      </Card>

      <Card title="Items" right={
        <FilterBar>
          <div><label style={label()}>Review status</label>
            <select style={select()} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">all</option><option value="draft">draft</option><option value="in_review">in review</option><option value="approved">approved</option><option value="rejected">rejected</option><option value="duplicate">duplicate</option>
            </select>
          </div>
        </FilterBar>
      }>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Stem</th><th style={th()}>Subject / Topic</th><th style={th()}>Difficulty</th><th style={th()}>p / r</th><th style={th()}>Status</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id}>
                  <td style={{ ...td(), maxWidth: 320 }}>{q.stem}</td>
                  <td style={td()}>{q.subject}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{q.topic}</div></td>
                  <td style={td()}><Badge status={q.difficulty} /></td>
                  <td style={td()}>{q.difficulty_index !== null ? q.difficulty_index.toFixed(2) : '—'} / {q.discrimination !== null ? q.discrimination.toFixed(2) : '—'}</td>
                  <td style={td()}><Badge status={q.review_status} /></td>
                  <td style={td()}>
                    {(q.review_status === 'in_review' || q.review_status === 'draft') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button onClick={() => review(q.id, 'approve')} style={btnPrimary()}>Approve</button>
                        <button onClick={() => review(q.id, 'reject')} style={btnDanger()}>Reject</button>
                        <button onClick={() => review(q.id, 'flag_duplicate')} style={btn()}>Duplicate</button>
                      </div>
                    ) : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
