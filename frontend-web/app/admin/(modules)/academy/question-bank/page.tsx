'use client';

import { useEffect, useState } from 'react';
import { listQuestionItems, createQuestionItem, reviewQuestionItem } from '@/services/academyAdminService';
import type { QuestionItem, QuestionItemInput, QuestionReviewInput } from '@/types/academyAdmin';
import { AcademyTabs, StateBlock, AuditNote, DisclosureNote, label, select, FilterBar } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

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
    <Page>
      <PageHeader title="Question bank" subtitle="Item authoring (MCQ + rich types); tag by subject/topic/difficulty/objective; review workflow; duplicate detection; item analysis (difficulty, discrimination)." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="question-bank" />
      <DisclosureNote>Requires <code>academy.assessment</code>. Items enter as drafts and must pass review before they are eligible for blueprints. Suspected duplicates are flagged, not deleted.</DisclosureNote>

      <Card title="Author new item">
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div><label style={label()}>Stem (question text)</label><Input value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} placeholder="Enter the question…" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
            <div><label style={label()}>Type</label>
              <select style={select()} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as QuestionItemInput['type'] })}>
                <option value="mcq">MCQ</option><option value="multi_select">Multi-select</option><option value="numeric">Numeric</option><option value="short_text">Short text</option>
              </select>
            </div>
            <div><label style={label()}>Subject</label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Physics" /></div>
            <div><label style={label()}>Topic</label><Input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Motion" /></div>
            <div><label style={label()}>Difficulty</label>
              <select style={select()} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as QuestionItemInput['difficulty'] })}>
                <option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option>
              </select>
            </div>
            <div><label style={label()}>Objective</label><Input value={form.objective ?? ''} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Optional" /></div>
          </div>
          {(form.type === 'mcq' || form.type === 'multi_select') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem' }}>
              {form.options.map((opt, idx) => (
                <div key={idx}><label style={label()}>Option {idx + 1}</label><Input value={opt} onChange={(e) => { const next = [...form.options]; next[idx] = e.target.value; setForm({ ...form, options: next }); }} /></div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Answer key</label><Input value={form.answer_key} onChange={(e) => setForm({ ...form, answer_key: e.target.value })} placeholder="Correct answer (comma-separate for multi-select)" /></div>
            <Button onClick={submit} disabled={saving} variant="primary" sm>{saving ? 'Saving…' : 'Create item'}</Button>
          </div>
        </div>
        {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
        <AuditNote>Authoring and review decisions are recorded to the immutable audit log.</AuditNote>
      </Card>

      <Card title="Items">
        <FilterBar>
          <div><label style={label()}>Review status</label>
            <select style={select()} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">all</option><option value="draft">draft</option><option value="in_review">in review</option><option value="approved">approved</option><option value="rejected">rejected</option><option value="duplicate">duplicate</option>
            </select>
          </div>
        </FilterBar>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No items match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Stem</th><th style={thCell}>Subject / Topic</th><th style={thCell}>Difficulty</th><th style={thCell}>p / r</th><th style={thCell}>Status</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id}>
                  <td style={{ ...tdCell, maxWidth: 320 }}>{q.stem}</td>
                  <td style={tdCell}>{q.subject}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{q.topic}</div></td>
                  <td style={tdCell}><StatusBadge status={q.difficulty} /></td>
                  <td style={tdCell}>{q.difficulty_index !== null ? q.difficulty_index.toFixed(2) : '—'} / {q.discrimination !== null ? q.discrimination.toFixed(2) : '—'}</td>
                  <td style={tdCell}><StatusBadge status={q.review_status} /></td>
                  <td style={tdCell}>
                    {(q.review_status === 'in_review' || q.review_status === 'draft') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <Button onClick={() => review(q.id, 'approve')} variant="primary" sm>Approve</Button>
                        <Button onClick={() => review(q.id, 'reject')} variant="danger" sm>Reject</Button>
                        <Button onClick={() => review(q.id, 'flag_duplicate')} variant="outline" sm>Duplicate</Button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
