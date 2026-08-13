'use client';

// 9.F — KYC review queue (approve/reject/request-more) + AML flags.
// 9.F.5 — Compliance dashboard: breaches, overrides, expiring docs.

import { useEffect, useState } from 'react';
import { listKycQueue, decideKyc, getComplianceDashboard } from '@/services/fractionalreAdminService';
import type { KycQueueItem, KycDecisionType, ComplianceDashboard } from '@/types/fractionalreAdmin';
import { FractionalReTabs, Kpi, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const CLASS_COLOR: Record<string, string> = { retail: colors.info, qualified: colors.secondary, hni: colors.success, institutional: colors.secondary };

export default function CompliancePage() {
  const [queue, setQueue] = useState<KycQueueItem[]>([]);
  const [dash, setDash] = useState<ComplianceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [q, d] = await Promise.all([listKycQueue(), getComplianceDashboard()]); setQueue(q); setDash(d); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(userId: string, decision: KycDecisionType) {
    const reason = decision === 'approve' ? 'Documents verified' : window.prompt(`Reason for ${decision}:`) || '';
    if (decision !== 'approve' && !reason) return;
    setBusy(userId); setError(null); setMsg(null);
    try { await decideKyc(userId, { decision, reason }); setMsg(`${decision} recorded for ${userId}.`); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Compliance" subtitle="KYC review, AML flags, breaches and overrides." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="compliance" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading || !dash ? <p style={{ color: colors.muted }}>Loading compliance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Open KYC" value={String(dash.openKycCount)} accent={colors.warning} />
            <Kpi label="AML open cases" value={String(dash.amlOpenCases)} accent={dash.amlOpenCases ? colors.danger : colors.success} />
            <Kpi label="Active breaches" value={String(dash.activeBreaches)} accent={dash.activeBreaches ? colors.danger : colors.success} />
            <Kpi label="Active overrides" value={String(dash.activeOverrides)} accent={colors.secondary} />
            <Kpi label="Expiring docs" value={String(dash.expiringDocsCount)} accent={colors.warning} />
          </div>

          <Card title="KYC review queue">
            {queue.length === 0 ? <p style={{ color: colors.muted }}>Queue empty.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Class</th><th style={thCell}>Submitted</th><th style={thCell}>SLA</th><th style={thCell}>AML flags</th><th style={thCell}>Docs</th><th style={thCell}>Decision</th></tr></thead>
                <tbody>{queue.map((k) => (
                  <tr key={k.userId}>
                    <td style={tdCell}>{k.name}</td>
                    <td style={tdCell}><Badge text={k.classification} color={CLASS_COLOR[k.classification.toLowerCase()] ?? colors.secondary} /></td>
                    <td style={tdCell}>{timeAgo(k.submittedAt)}</td>
                    <td style={{ ...tdCell, color: k.slaHoursRemaining < 0 ? colors.danger : k.slaHoursRemaining < 6 ? colors.warning : colors.success }}>{k.slaHoursRemaining < 0 ? `${Math.abs(k.slaHoursRemaining)}h overdue` : `${k.slaHoursRemaining}h left`}</td>
                    <td style={tdCell}>{k.amlFlags.length ? k.amlFlags.map((f) => <Badge key={f} text={f} color={colors.danger} />) : <span style={{ color: colors.success }}>clear</span>}</td>
                    <td style={tdCell}>{k.documents.map((d) => d.name).join(', ')}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        <Button variant="primary" sm disabled={busy === k.userId} onClick={() => decide(k.userId, 'approve')}>Approve</Button>
                        <Button variant="danger" sm disabled={busy === k.userId} onClick={() => decide(k.userId, 'reject')}>Reject</Button>
                        <Button sm disabled={busy === k.userId} onClick={() => decide(k.userId, 'request_more')}>Request more</Button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Card title="Active breaches (10% cap)">
              {dash.breaches.length === 0 ? <p style={{ color: colors.success }}>No active breaches.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Detail</th><th style={thCell}>When</th></tr></thead>
                  <tbody>{dash.breaches.map((b, i) => (<tr key={i}><td style={tdCell}>{b.investorName}</td><td style={tdCell}>{b.detail}</td><td style={tdCell}>{timeAgo(b.at)}</td></tr>))}</tbody>
                </table>
              )}
            </Card>
            <Card title="Logged overrides">
              {dash.overrides.length === 0 ? <p style={{ color: colors.muted }}>No active overrides.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Reason</th><th style={thCell}>By</th><th style={thCell}>When</th></tr></thead>
                  <tbody>{dash.overrides.map((o, i) => (<tr key={i}><td style={tdCell}>{o.investorName}</td><td style={tdCell}>{o.reason}</td><td style={tdCell}>{o.by}</td><td style={tdCell}>{timeAgo(o.at)}</td></tr>))}</tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
