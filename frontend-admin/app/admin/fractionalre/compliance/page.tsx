'use client';

// 9.F — KYC review queue (approve/reject/request-more) + AML flags.
// 9.F.5 — Compliance dashboard: breaches, overrides, expiring docs.

import { useEffect, useState } from 'react';
import { listKycQueue, decideKyc, getComplianceDashboard } from '@/services/fractionalreAdminService';
import type { KycQueueItem, KycDecisionType, ComplianceDashboard } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Kpi, Badge, btn, btnPrimary, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Compliance" subtitle="KYC review, AML flags, breaches and overrides." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="compliance" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      {loading || !dash ? <p style={{ color: '#6b7280' }}>Loading compliance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Open KYC" value={String(dash.openKycCount)} accent="#d97706" />
            <Kpi label="AML open cases" value={String(dash.amlOpenCases)} accent={dash.amlOpenCases ? '#dc2626' : '#16a34a'} />
            <Kpi label="Active breaches" value={String(dash.activeBreaches)} accent={dash.activeBreaches ? '#dc2626' : '#16a34a'} />
            <Kpi label="Active overrides" value={String(dash.activeOverrides)} accent="#6b21a8" />
            <Kpi label="Expiring docs" value={String(dash.expiringDocsCount)} accent="#d97706" />
          </div>

          <Card title="KYC review queue">
            {queue.length === 0 ? <p style={{ color: '#6b7280' }}>Queue empty.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Investor</th><th style={th()}>Class</th><th style={th()}>Submitted</th><th style={th()}>SLA</th><th style={th()}>AML flags</th><th style={th()}>Docs</th><th style={th()}>Decision</th></tr></thead>
                <tbody>{queue.map((k) => (
                  <tr key={k.userId}>
                    <td style={td()}>{k.name}</td>
                    <td style={td()}><Badge status={k.classification} /></td>
                    <td style={td()}>{timeAgo(k.submittedAt)}</td>
                    <td style={{ ...td(), color: k.slaHoursRemaining < 0 ? '#dc2626' : k.slaHoursRemaining < 6 ? '#d97706' : '#15803d' }}>{k.slaHoursRemaining < 0 ? `${Math.abs(k.slaHoursRemaining)}h overdue` : `${k.slaHoursRemaining}h left`}</td>
                    <td style={td()}>{k.amlFlags.length ? k.amlFlags.map((f) => <Badge key={f} status="high" label={f} />) : <span style={{ color: '#15803d' }}>clear</span>}</td>
                    <td style={td()}>{k.documents.map((d) => d.name).join(', ')}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        <button disabled={busy === k.userId} onClick={() => decide(k.userId, 'approve')} style={btnPrimary('#16a34a')}>Approve</button>
                        <button disabled={busy === k.userId} onClick={() => decide(k.userId, 'reject')} style={btnPrimary('#dc2626')}>Reject</button>
                        <button disabled={busy === k.userId} onClick={() => decide(k.userId, 'request_more')} style={btn()}>Request more</button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Card title="Active breaches (10% cap)">
              {dash.breaches.length === 0 ? <p style={{ color: '#15803d' }}>No active breaches.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Investor</th><th style={th()}>Detail</th><th style={th()}>When</th></tr></thead>
                  <tbody>{dash.breaches.map((b, i) => (<tr key={i}><td style={td()}>{b.investorName}</td><td style={td()}>{b.detail}</td><td style={td()}>{timeAgo(b.at)}</td></tr>))}</tbody>
                </table>
              )}
            </Card>
            <Card title="Logged overrides">
              {dash.overrides.length === 0 ? <p style={{ color: '#6b7280' }}>No active overrides.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Investor</th><th style={th()}>Reason</th><th style={th()}>By</th><th style={th()}>When</th></tr></thead>
                  <tbody>{dash.overrides.map((o, i) => (<tr key={i}><td style={td()}>{o.investorName}</td><td style={td()}>{o.reason}</td><td style={td()}>{o.by}</td><td style={td()}>{timeAgo(o.at)}</td></tr>))}</tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
