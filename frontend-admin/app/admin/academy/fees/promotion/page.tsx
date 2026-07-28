'use client';

// SC-35/36 · Promotion Console + Class/Session Rollover (SF-3).
// TWO-approval gate: class_teacher THEN head_teacher. A single approval is
// structurally NOT enough to apply the rollover — the UI makes this visible:
// the Apply button stays disabled until BOTH approvals are recorded.

import { useEffect, useState } from 'react';
import { listPromotions, approvePromotion, applyPromotion, PROMOTION_FLOW } from '@/services/academyFeesService';
import type { PromotionBatch } from '@/types/academyFees';
import {
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';

export default function FeesPromotionPage() {
  const [batches, setBatches] = useState<PromotionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setBatches(await listPromotions()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function approve(b: PromotionBatch, role: 'class_teacher' | 'head_teacher') {
    setBusy(b.id); setNotice(null);
    try { const u = await approvePromotion({ batch_id: b.id, role }); setNotice(`${role.replace('_', ' ')} approval recorded for ${u.from_class} → ${u.to_class}. Status: ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function apply(b: PromotionBatch) {
    setBusy(b.id); setNotice(null);
    try { const u = await applyPromotion(b.id); setNotice(`Rollover applied: ${u.from_class} → ${u.to_class}. Classes and fee schedules reassigned.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const readyToApply = batches.filter((b) => b.status === 'promotion_approved').length;
  const awaitingApproval = batches.filter((b) => b.status === 'promotion_computed' || b.status === 'promotion_reviewed').length;

  return (
    <FeesGuard permission="academy.fees.promotion.approve">
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Promotion & Rollover" subtitle="End-of-session promotion with the two-approval gate, then class/session rollover. Both a teacher and a head-teacher approval are structurally required before rollover applies." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="promotion" />
      <DisclosureNote>Requires <code>academy.fees.promotion.approve</code>. <strong>SF-3 — two-approval gate:</strong> a promotion must be approved by the <strong>class teacher</strong> and <em>then</em> the <strong>head teacher</strong>. No path skips <code>promotion_computed → applied</code>; a single approval is <strong>not</strong> enough (release blocker if violated).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Awaiting approval" value={awaitingApproval.toString()} accent={awaitingApproval > 0 ? '#9a3412' : undefined} />
          <Kpi label="Ready to apply" value={readyToApply.toString()} accent={readyToApply > 0 ? '#15803d' : undefined} />
          <Kpi label="Applied" value={batches.filter((b) => b.status === 'applied').length.toString()} />
        </div>

        <Card title="Promotion lifecycle (SF-3)">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {PROMOTION_FLOW.map((st, i) => (
              <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Badge status={st === 'applied' ? 'approved' : st === 'promotion_computed' ? 'draft' : 'pending'} label={st.replace(/_/g, ' ')} />
                {i < PROMOTION_FLOW.length - 1 ? <span style={{ color: '#9ca3af' }}>→</span> : null}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>The <strong>two</strong> approval steps (<code>promotion_reviewed</code> = teacher, <code>promotion_approved</code> = head teacher) are both mandatory.</p>
        </Card>

        <Card title="Promotion batches">
          {batches.map((b) => {
            const teacherDone = Boolean(b.teacher_approved_by);
            const headDone = Boolean(b.head_approved_by);
            const canApply = b.status === 'promotion_approved';
            return (
              <div key={b.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong>{b.from_class} → {b.to_class}</strong>
                    <span style={{ marginLeft: '0.6rem', fontSize: '0.82rem', color: '#6b7280' }}>{b.students_promoted} promoted · {b.students_retained} retained · {b.students_total} total</span>
                  </div>
                  <Badge status={b.status === 'applied' ? 'approved' : b.status === 'promotion_computed' ? 'draft' : 'pending'} label={b.status.replace(/_/g, ' ')} />
                </div>

                {/* Two-approval progress — makes SF-3 visible */}
                <div style={{ display: 'flex', gap: '1.5rem', margin: '0.7rem 0', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.82rem' }}>
                    <div style={{ color: '#6b7280', textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 600, letterSpacing: 0.3 }}>Approval 1 · Class teacher</div>
                    {teacherDone ? <div style={{ color: '#15803d', fontWeight: 600 }}>✓ {b.teacher_approved_by} · {fmtDate(b.teacher_approved_at)}</div> : <div style={{ color: '#9a3412' }}>Pending</div>}
                  </div>
                  <div style={{ fontSize: '0.82rem' }}>
                    <div style={{ color: '#6b7280', textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 600, letterSpacing: 0.3 }}>Approval 2 · Head teacher</div>
                    {headDone ? <div style={{ color: '#15803d', fontWeight: 600 }}>✓ {b.head_approved_by} · {fmtDate(b.head_approved_at)}</div> : <div style={{ color: '#9a3412' }}>{teacherDone ? 'Pending' : 'Blocked — needs teacher approval first'}</div>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderTop: '1px solid #f3f4f6', paddingTop: '0.6rem' }}>
                  <button onClick={() => approve(b, 'class_teacher')} disabled={busy === b.id || teacherDone || b.status !== 'promotion_computed'} style={btnPrimary()}>Approve as class teacher</button>
                  <button onClick={() => approve(b, 'head_teacher')} disabled={busy === b.id || headDone || !teacherDone || b.status !== 'promotion_reviewed'} style={btnPrimary()} title={!teacherDone ? 'SF-3: requires a prior teacher approval' : ''}>Approve as head teacher</button>
                  <button onClick={() => apply(b)} disabled={busy === b.id || !canApply} style={{ ...btn(), border: '1px solid #15803d', background: canApply ? '#15803d' : '#fff', color: canApply ? '#fff' : '#9ca3af', fontWeight: 600 }} title={!canApply ? 'SF-3: both approvals required before rollover' : ''}>Apply rollover</button>
                  {b.status === 'applied' && <span style={{ color: '#15803d', fontSize: '0.82rem', alignSelf: 'center' }}>Rollover applied.</span>}
                </div>
                {!canApply && b.status !== 'applied' && <p style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: '0.4rem' }}>Apply is disabled: a single approval is not enough — both teacher and head-teacher approvals are required (SF-3).</p>}
              </div>
            );
          })}
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Each approval and the final rollover are recorded to the immutable audit log (module <code>academy.fees</code>), preserving who approved each of the two gates.</AuditNote>
        </Card>
      </StateBlock>
    </div>
    </FeesGuard>
  );
}
