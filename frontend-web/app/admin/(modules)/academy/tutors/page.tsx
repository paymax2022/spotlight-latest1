'use client';

import { useEffect, useState } from 'react';
import {
  listTutors, vetTutor, listTutorPayouts, listTutorDisputes, noteTutorDispute,
} from '@/services/academyAdminService';
import type { Tutor, TutorPayout, TutorDispute } from '@/types/academyAdmin';
import { AcademyTabs, Kpi, StateBlock, AuditNote, DisclosureNote, select, formatNaira, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched', 'tier1', 'tier2', 'tier3'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

function Stars({ value }: { value: number }) {
  if (!value) return <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>;
  const full = Math.round(value);
  return <span style={{ fontSize: '0.85rem', color: colors.text }} title={`${value.toFixed(1)} / 5`}>{'★'.repeat(full)}<span style={{ color: colors.inputBorder }}>{'★'.repeat(5 - full)}</span> {value.toFixed(1)}</span>;
}

export default function TutorOpsPage() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [payouts, setPayouts] = useState<TutorPayout[]>([]);
  const [disputes, setDisputes] = useState<TutorDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [noteForm, setNoteForm] = useState<Record<string, { status: TutorDispute['status']; note: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const [t, p, d] = await Promise.all([listTutors(), listTutorPayouts(), listTutorDisputes()]);
      setTutors(t); setPayouts(p); setDisputes(d);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function vet(t: Tutor, action: 'verify' | 'suspend' | 'reactivate' | 'reject') {
    setBusy(t.id); setNotice(null);
    try { const u = await vetTutor({ id: t.id, action }); setNotice(`${u.display_name} → ${u.vetting}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function saveNote(d: TutorDispute) {
    const f = noteForm[d.id];
    if (!f?.note) { setNotice('A note is required to update a dispute.'); return; }
    setBusy(d.id); setNotice(null);
    try { const u = await noteTutorDispute({ id: d.id, status: f.status, note: f.note }); setNotice(`Dispute ${u.id} → ${u.status}.`); setNoteForm({ ...noteForm, [d.id]: { status: u.status, note: '' } }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const verified = tutors.filter((t) => t.vetting === 'verified').length;
  const pendingVet = tutors.filter((t) => t.vetting === 'applied' || t.vetting === 'in_review').length;
  const payoutsDue = payouts.filter((p) => p.status === 'requested' || p.status === 'processing').reduce((s, p) => s + p.amount_kobo, 0);
  const failedPayouts = payouts.filter((p) => p.status === 'failed').length;
  const openDisputes = disputes.filter((d) => d.status === 'open' || d.status === 'investigating').length;

  return (
    <Page>
      <PageHeader title="Tutor & marketplace ops" subtitle="Tutor vetting (verify/suspend) with KYC state, payout runs (requested/paid/failed), ratings, and dispute handling." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="tutors" />
      <DisclosureNote>Requires <code>academy.tutor</code>. Vetting state machine: <strong>applied → in_review → verified | rejected</strong>; verified ↔ suspended. Payouts post to the finance ledger; all actions are audit-logged. Money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Verified tutors" value={verified.toString()} sub={`${tutors.length} total`} accent={colors.primary} />
          <Kpi label="Pending vetting" value={pendingVet.toString()} accent={pendingVet > 0 ? colors.warning : undefined} />
          <Kpi label="Payouts due" value={formatNaira(payoutsDue)} accent={colors.success} />
          <Kpi label="Failed payouts" value={failedPayouts.toString()} accent={failedPayouts > 0 ? colors.danger : undefined} />
          <Kpi label="Open disputes" value={openDisputes.toString()} accent={openDisputes > 0 ? colors.warning : undefined} />
        </div>

        <Card title="Tutors — vetting & KYC">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Tutor</th><th style={thCell}>Subjects</th><th style={thCell}>KYC</th><th style={thCell}>Rating</th><th style={thCell}>Sessions</th><th style={thCell}>Disputes</th><th style={thCell}>Vetting</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {tutors.map((t) => (
                <tr key={t.id}>
                  <td style={tdCell}><strong>{t.display_name}</strong><br /><span style={{ color: colors.muted, fontSize: '0.75rem' }}>{t.email}</span></td>
                  <td style={tdCell}>{t.subjects.join(', ')}</td>
                  <td style={tdCell}><StatusBadge status={t.kyc} label={t.kyc.replace('tier', 'Tier ')} /></td>
                  <td style={tdCell}><Stars value={t.rating_avg} /> {t.ratings_count ? <span style={{ color: colors.muted, fontSize: '0.72rem' }}>({t.ratings_count})</span> : null}</td>
                  <td style={tdCell}>{t.sessions_delivered.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{t.open_disputes > 0 ? <span style={{ color: colors.danger, fontWeight: 600 }}>{t.open_disputes}</span> : '0'}</td>
                  <td style={tdCell}><StatusBadge status={t.vetting} label={t.vetting.replace(/_/g, ' ')} /></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {t.vetting === 'verified'
                        ? <Button onClick={() => vet(t, 'suspend')} disabled={busy === t.id} variant="danger" sm>Suspend</Button>
                        : t.vetting === 'suspended'
                          ? <Button onClick={() => vet(t, 'reactivate')} disabled={busy === t.id} variant="primary" sm>Reactivate</Button>
                          : (
                            <>
                              <Button onClick={() => vet(t, 'verify')} disabled={busy === t.id} variant="primary" sm>Verify</Button>
                              <Button onClick={() => vet(t, 'reject')} disabled={busy === t.id} variant="danger" sm>Reject</Button>
                            </>
                          )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Payouts">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Tutor</th><th style={thCell}>Period</th><th style={thCell}>Amount</th><th style={thCell}>Bank</th><th style={thCell}>Requested</th><th style={thCell}>Settled</th><th style={thCell}>Status</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={tdCell}>{p.tutor_name}</td>
                  <td style={tdCell}>{p.period}</td>
                  <td style={tdCell}>{formatNaira(p.amount_kobo)}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{p.bank_account}</code></td>
                  <td style={tdCell}>{fmtDate(p.requested_at)}</td>
                  <td style={tdCell}>{p.settled_at ? fmtDate(p.settled_at) : '—'}</td>
                  <td style={tdCell}><StatusBadge status={p.status} />{p.failure_reason ? <div style={{ color: colors.danger, fontSize: '0.72rem', marginTop: '0.2rem' }}>{p.failure_reason}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Ratings & disputes">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Tutor</th><th style={thCell}>Learner</th><th style={thCell}>Reason</th><th style={thCell}>Detail</th><th style={thCell}>Status</th><th style={thCell}>Resolution note</th></tr></thead>
            <tbody>
              {disputes.map((d) => {
                const f = noteForm[d.id] ?? { status: d.status, note: '' };
                const terminal = d.status === 'resolved' || d.status === 'dismissed';
                return (
                  <tr key={d.id}>
                    <td style={tdCell}><strong>{d.tutor_name}</strong></td>
                    <td style={tdCell}>{d.learner_name}</td>
                    <td style={tdCell}><StatusBadge status="medium" label={d.reason.replace(/_/g, ' ')} /></td>
                    <td style={tdCell}>{d.detail}{d.note ? <div style={{ color: colors.muted, fontSize: '0.72rem', marginTop: '0.25rem' }}>Note: {d.note}</div> : null}</td>
                    <td style={tdCell}><StatusBadge status={d.status} /></td>
                    <td style={tdCell}>
                      {terminal ? <span style={{ color: colors.muted, fontSize: '0.8rem' }}>closed</span> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 200 }}>
                          <select style={select()} value={f.status} onChange={(e) => setNoteForm({ ...noteForm, [d.id]: { ...f, status: e.target.value as TutorDispute['status'] } })}>
                            <option value="open">open</option>
                            <option value="investigating">investigating</option>
                            <option value="resolved">resolved</option>
                            <option value="dismissed">dismissed</option>
                          </select>
                          <Input placeholder="Add a note…" value={f.note} onChange={(e) => setNoteForm({ ...noteForm, [d.id]: { ...f, note: e.target.value } })} />
                          <Button onClick={() => saveNote(d)} disabled={busy === d.id} variant="primary" sm>Save note</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Tutor vetting decisions, payout actions and dispute notes are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </Page>
  );
}
