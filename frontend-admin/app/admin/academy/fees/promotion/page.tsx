'use client';

// SC-35/36 · Promotion Console + Class/Session Rollover (SF-3).
// TWO-approval gate: class_teacher THEN head_teacher. A single approval is
// structurally NOT enough to apply the rollover — the UI makes this visible:
// the Apply button stays disabled until BOTH approvals are recorded.

import { useEffect, useState } from 'react';
import { listPromotions, approvePromotion, applyPromotion, PROMOTION_FLOW } from '@/services/academyFeesService';
import type { PromotionBatch } from '@/types/academyFees';
import {
  Kpi, StateBlock, DisclosureNote, AuditNote, fmtDate,
} from '../../_ui';
import { FeesTabs, FeesGuard } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="Promotion & Rollover" subtitle="End-of-session promotion with the two-approval gate, then class/session rollover. Both a teacher and a head-teacher approval are structurally required before rollover applies." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <FeesTabs active="promotion" />
      <DisclosureNote>Requires <code>academy.fees.promotion.approve</code>. <strong>SF-3 — two-approval gate:</strong> a promotion must be approved by the <strong>class teacher</strong> and <em>then</em> the <strong>head teacher</strong>. No path skips <code>promotion_computed → applied</code>; a single approval is <strong>not</strong> enough (release blocker if violated).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Awaiting approval" value={awaitingApproval.toString()} accent={awaitingApproval > 0 ? colors.warning : undefined} />
          <Kpi label="Ready to apply" value={readyToApply.toString()} accent={readyToApply > 0 ? colors.success : undefined} />
          <Kpi label="Applied" value={batches.filter((b) => b.status === 'applied').length.toString()} />
        </div>

        <Card title="Promotion lifecycle (SF-3)">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {PROMOTION_FLOW.map((st, i) => (
              <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <StatusBadge status={st === 'applied' ? 'approved' : st === 'promotion_computed' ? 'draft' : 'pending'} label={st.replace(/_/g, ' ')} />
                {i < PROMOTION_FLOW.length - 1 ? <span style={{ color: colors.muted }}>→</span> : null}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.5rem' }}>The <strong>two</strong> approval steps (<code>promotion_reviewed</code> = teacher, <code>promotion_approved</code> = head teacher) are both mandatory.</p>
        </Card>

        <Card title="Promotion batches">
          {batches.map((b) => {
            const teacherDone = Boolean(b.teacher_approved_by);
            const headDone = Boolean(b.head_approved_by);
            const canApply = b.status === 'promotion_approved';
            return (
              <div key={b.id} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong>{b.from_class} → {b.to_class}</strong>
                    <span style={{ marginLeft: '0.6rem', fontSize: '0.82rem', color: colors.muted }}>{b.students_promoted} promoted · {b.students_retained} retained · {b.students_total} total</span>
                  </div>
                  <StatusBadge status={b.status === 'applied' ? 'approved' : b.status === 'promotion_computed' ? 'draft' : 'pending'} label={b.status.replace(/_/g, ' ')} />
                </div>

                {/* Two-approval progress — makes SF-3 visible */}
                <div style={{ display: 'flex', gap: '1.5rem', margin: '0.7rem 0', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.82rem' }}>
                    <div style={{ color: colors.muted, textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 600, letterSpacing: 0.3 }}>Approval 1 · Class teacher</div>
                    {teacherDone ? <div style={{ color: colors.success, fontWeight: 600 }}>✓ {b.teacher_approved_by} · {fmtDate(b.teacher_approved_at)}</div> : <div style={{ color: colors.warning }}>Pending</div>}
                  </div>
                  <div style={{ fontSize: '0.82rem' }}>
                    <div style={{ color: colors.muted, textTransform: 'uppercase', fontSize: '0.68rem', fontWeight: 600, letterSpacing: 0.3 }}>Approval 2 · Head teacher</div>
                    {headDone ? <div style={{ color: colors.success, fontWeight: 600 }}>✓ {b.head_approved_by} · {fmtDate(b.head_approved_at)}</div> : <div style={{ color: colors.warning }}>{teacherDone ? 'Pending' : 'Blocked — needs teacher approval first'}</div>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: '0.6rem' }}>
                  <Button onClick={() => approve(b, 'class_teacher')} disabled={busy === b.id || teacherDone || b.status !== 'promotion_computed'} variant="primary" sm>Approve as class teacher</Button>
                  <Button onClick={() => approve(b, 'head_teacher')} disabled={busy === b.id || headDone || !teacherDone || b.status !== 'promotion_reviewed'} variant="primary" sm title={!teacherDone ? 'SF-3: requires a prior teacher approval' : ''}>Approve as head teacher</Button>
                  <Button onClick={() => apply(b)} disabled={busy === b.id || !canApply} variant="outline" sm style={{ borderColor: colors.success, background: canApply ? colors.success : colors.card, color: canApply ? '#fff' : colors.muted, fontWeight: 600 }} title={!canApply ? 'SF-3: both approvals required before rollover' : ''}>Apply rollover</Button>
                  {b.status === 'applied' && <span style={{ color: colors.success, fontSize: '0.82rem', alignSelf: 'center' }}>Rollover applied.</span>}
                </div>
                {!canApply && b.status !== 'applied' && <p style={{ fontSize: '0.75rem', color: colors.danger, marginTop: '0.4rem' }}>Apply is disabled: a single approval is not enough — both teacher and head-teacher approvals are required (SF-3).</p>}
              </div>
            );
          })}
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Each approval and the final rollover are recorded to the immutable audit log (module <code>academy.fees</code>), preserving who approved each of the two gates.</AuditNote>
        </Card>
      </StateBlock>
    </Page>
    </FeesGuard>
  );
}
