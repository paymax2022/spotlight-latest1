'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listModerationReports, triageModerationReport, decideModerationReport, escalateModerationReport,
} from '@/services/academyAdminService';
import type { ModerationReport, ReportEntityType, ReportState, ModerationDecision } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, FilterBar, btn, btnPrimary, btnDanger, th, td, label, select, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Moderation & trust/safety" subtitle="Content &amp; community report queue with triage and decisions (hide / warn / ban / dismiss); child-safety controls and escalation." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="moderation" />
      <DisclosureNote>
        Requires <code>academy.moderation</code>. Report lifecycle: <strong>open → triaged → actioned | dismissed | escalated</strong>. <strong>Child-safety (CSAE) reports are escalated to the dedicated safety desk</strong> and routed to the statutory reporting pipeline — never resolved inline. All decisions are recorded to the immutable audit log.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Open reports" value={openCount.toString()} accent={openCount > 0 ? '#9a3412' : undefined} />
          <Kpi label="Child-safety active" value={childSafety.toString()} accent={childSafety > 0 ? '#b91c1c' : undefined} />
          <Kpi label="Escalated" value={escalatedCount.toString()} accent={escalatedCount > 0 ? '#b91c1c' : undefined} />
          <Kpi label="Total reports" value={reports.length.toString()} />
        </div>

        <Card title="Reports queue">
          <FilterBar>
            <div><label style={label()}>Entity type</label><select style={select()} value={fType} onChange={(e) => setFType(e.target.value)}><option value="all">All types</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
            <div><label style={label()}>State</label><select style={select()} value={fState} onChange={(e) => setFState(e.target.value)}><option value="all">All states</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label style={label()}>Child-safety</label><select style={select()} value={fChild} onChange={(e) => setFChild(e.target.value)}><option value="all">All</option><option value="yes">Child-safety only</option><option value="no">Exclude</option></select></div>
          </FilterBar>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Subject</th><th style={th()}>Type</th><th style={th()}>Reason</th><th style={th()}>Severity</th><th style={th()}>State</th><th style={th()}>Assignee</th><th style={th()}>Reported</th><th style={th()}>Triage / Decide</th></tr></thead>
            <tbody>
              {filtered.map((r) => {
                const terminal = r.state === 'actioned' || r.state === 'dismissed';
                return (
                  <tr key={r.id}>
                    <td style={td()}>
                      <strong>{r.entity_label}</strong>
                      <div style={{ color: '#9ca3af', fontSize: '0.72rem' }}><code>{r.entity_ref}</code></div>
                      {r.child_safety ? <span style={{ display: 'inline-block', marginTop: '0.2rem' }}><Badge status="critical" label="child-safety" /></span> : null}
                      {r.notes ? <div style={{ color: '#6b7280', fontSize: '0.72rem', marginTop: '0.2rem' }}>{r.notes}</div> : null}
                    </td>
                    <td style={td()}>{r.entity_type.replace(/_/g, ' ')}</td>
                    <td style={td()}>{r.reason.replace(/_/g, ' ')}</td>
                    <td style={td()}><Badge status={r.severity} /></td>
                    <td style={td()}><Badge status={r.state} />{r.decision ? <div style={{ marginTop: '0.2rem' }}><Badge status={r.decision} label={r.decision} /></div> : null}</td>
                    <td style={td()}>{r.assignee ?? '—'}</td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                    <td style={td()}>
                      {terminal ? <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>resolved</span> : r.state === 'escalated' ? <span style={{ color: '#b91c1c', fontSize: '0.8rem' }}>at safety desk</span> : (
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {r.state === 'open' ? <button onClick={() => triage(r)} disabled={busy === r.id} style={btn()}>Triage</button> : null}
                          {r.child_safety ? (
                            <button onClick={() => escalate(r)} disabled={busy === r.id} style={btnDanger()}>Escalate</button>
                          ) : (
                            <>
                              <select style={{ ...select(), width: 90 }} value={decisionSel[r.id] ?? 'hide'} onChange={(e) => setDecisionSel({ ...decisionSel, [r.id]: e.target.value as ModerationDecision })}>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                              <button onClick={() => decide(r)} disabled={busy === r.id} style={btnPrimary()}>Decide</button>
                              <button onClick={() => escalate(r)} disabled={busy === r.id} style={btn()}>Escalate</button>
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
          {filtered.length === 0 ? <p style={{ color: '#6b7280', marginTop: '0.75rem' }}>No reports match the current filters.</p> : null}
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Triage, moderation decisions (hide / warn / ban / dismiss) and escalations are recorded to the immutable audit log. Child-safety reports route to the statutory reporting pipeline.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
