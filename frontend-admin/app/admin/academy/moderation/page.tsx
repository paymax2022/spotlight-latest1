'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listModerationReports, triageModerationReport, decideModerationReport, escalateModerationReport,
} from '@/services/academyAdminService';
import type { ModerationReport, ReportEntityType, ReportState, ModerationDecision } from '@/types/academyAdmin';
import { AcademyTabs, Kpi, StateBlock, AuditNote, DisclosureNote, FilterBar, label, select, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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

const ENTITY_TYPES: ReportEntityType[] = ['content', 'comment', 'profile', 'live_chat', 'question'];
const STATES: ReportState[] = ['open', 'triaged', 'actioned', 'dismissed', 'escalated'];
const DECISIONS: ModerationDecision[] = ['hide', 'warn', 'ban', 'dismiss'];

export default function ModerationPage() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [fType, setFType] = useState<string>('all');
  const [fState, setFState] = useState<string>('all');
  const [fChild, setFChild] = useState<string>('all');
  const [decisionSel, setDecisionSel] = useState<Record<string, ModerationDecision>>({});

  async function load() {
    setLoading(true); setError(null);
    try { setReports(await listModerationReports()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => reports.filter((r) =>
    (fType === 'all' || r.entity_type === fType) &&
    (fState === 'all' || r.state === fState) &&
    (fChild === 'all' || (fChild === 'yes' ? r.child_safety : !r.child_safety))
  ), [reports, fType, fState, fChild]);

  async function triage(r: ModerationReport) {
    setBusy(r.id); setNotice(null);
    try { const u = await triageModerationReport({ id: r.id, assignee: 'you' }); setNotice(`Report ${u.id} triaged.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function decide(r: ModerationReport) {
    const d = decisionSel[r.id] ?? 'hide';
    const notes = typeof window !== 'undefined' ? (window.prompt(`Notes for "${d}" on ${r.id}?`, '') ?? undefined) : undefined;
    setBusy(r.id); setNotice(null);
    try { const u = await decideModerationReport({ id: r.id, decision: d, notes }); setNotice(`Report ${u.id} → ${d} (${u.state}).`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function escalate(r: ModerationReport) {
    const reason = typeof window !== 'undefined' ? window.prompt(`Escalation reason for ${r.id}?`, r.child_safety ? 'Child-safety: route to safety desk' : '') : '';
    if (!reason) { setNotice('An escalation reason is required.'); return; }
    setBusy(r.id); setNotice(null);
    try { const u = await escalateModerationReport({ id: r.id, reason }); setNotice(`Report ${u.id} escalated.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const openCount = reports.filter((r) => r.state === 'open').length;
  const childSafety = reports.filter((r) => r.child_safety && r.state !== 'actioned' && r.state !== 'dismissed').length;
  const escalatedCount = reports.filter((r) => r.state === 'escalated').length;

  return (
    <Page>
      <PageHeader title="Moderation & trust/safety" subtitle="Content &amp; community report queue with triage and decisions (hide / warn / ban / dismiss); child-safety controls and escalation." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="moderation" />
      <DisclosureNote>
        Requires <code>academy.moderation</code>. Report lifecycle: <strong>open → triaged → actioned | dismissed | escalated</strong>. <strong>Child-safety (CSAE) reports are escalated to the dedicated safety desk</strong> and routed to the statutory reporting pipeline — never resolved inline. All decisions are recorded to the immutable audit log.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Open reports" value={openCount.toString()} accent={openCount > 0 ? colors.warning : undefined} />
          <Kpi label="Child-safety active" value={childSafety.toString()} accent={childSafety > 0 ? colors.danger : undefined} />
          <Kpi label="Escalated" value={escalatedCount.toString()} accent={escalatedCount > 0 ? colors.danger : undefined} />
          <Kpi label="Total reports" value={reports.length.toString()} />
        </div>

        <Card title="Reports queue">
          <FilterBar>
            <div><label style={label()}>Entity type</label><select style={select()} value={fType} onChange={(e) => setFType(e.target.value)}><option value="all">All types</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
            <div><label style={label()}>State</label><select style={select()} value={fState} onChange={(e) => setFState(e.target.value)}><option value="all">All states</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label style={label()}>Child-safety</label><select style={select()} value={fChild} onChange={(e) => setFChild(e.target.value)}><option value="all">All</option><option value="yes">Child-safety only</option><option value="no">Exclude</option></select></div>
          </FilterBar>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Subject</th><th style={thCell}>Type</th><th style={thCell}>Reason</th><th style={thCell}>Severity</th><th style={thCell}>State</th><th style={thCell}>Assignee</th><th style={thCell}>Reported</th><th style={thCell}>Triage / Decide</th></tr></thead>
            <tbody>
              {filtered.map((r) => {
                const terminal = r.state === 'actioned' || r.state === 'dismissed';
                return (
                  <tr key={r.id}>
                    <td style={tdCell}>
                      <strong>{r.entity_label}</strong>
                      <div style={{ color: colors.muted, fontSize: '0.72rem' }}><code>{r.entity_ref}</code></div>
                      {r.child_safety ? <span style={{ display: 'inline-block', marginTop: '0.2rem' }}><StatusBadge status="critical" label="child-safety" /></span> : null}
                      {r.notes ? <div style={{ color: colors.muted, fontSize: '0.72rem', marginTop: '0.2rem' }}>{r.notes}</div> : null}
                    </td>
                    <td style={tdCell}>{r.entity_type.replace(/_/g, ' ')}</td>
                    <td style={tdCell}>{r.reason.replace(/_/g, ' ')}</td>
                    <td style={tdCell}><StatusBadge status={r.severity} /></td>
                    <td style={tdCell}><StatusBadge status={r.state} />{r.decision ? <div style={{ marginTop: '0.2rem' }}><StatusBadge status={r.decision} label={r.decision} /></div> : null}</td>
                    <td style={tdCell}>{r.assignee ?? '—'}</td>
                    <td style={tdCell}>{timeAgo(r.created_at)}</td>
                    <td style={tdCell}>
                      {terminal ? <span style={{ color: colors.muted, fontSize: '0.8rem' }}>resolved</span> : r.state === 'escalated' ? <span style={{ color: colors.danger, fontSize: '0.8rem' }}>at safety desk</span> : (
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {r.state === 'open' ? <Button onClick={() => triage(r)} disabled={busy === r.id} variant="outline" sm>Triage</Button> : null}
                          {r.child_safety ? (
                            <Button onClick={() => escalate(r)} disabled={busy === r.id} variant="danger" sm>Escalate</Button>
                          ) : (
                            <>
                              <select style={{ ...select(), width: 90 }} value={decisionSel[r.id] ?? 'hide'} onChange={(e) => setDecisionSel({ ...decisionSel, [r.id]: e.target.value as ModerationDecision })}>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                              <Button onClick={() => decide(r)} disabled={busy === r.id} variant="primary" sm>Decide</Button>
                              <Button onClick={() => escalate(r)} disabled={busy === r.id} variant="outline" sm>Escalate</Button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No reports match the current filters.</p> : null}
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Triage, moderation decisions (hide / warn / ban / dismiss) and escalations are recorded to the immutable audit log. Child-safety reports route to the statutory reporting pipeline.</AuditNote>
        </Card>
      </StateBlock>
    </Page>
  );
}
