'use client';

import { useCallback, useEffect, useState } from 'react';
import { getComplianceSummary, listAuditLogs, listDataRequests, fulfilDataRequest } from '@/services/crowdfundingAdminService';
import type { CfComplianceSummary, CfAuditLog, CfDataRequest } from '@/types/crowdfunding';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const DR_BADGE: Record<string, string> = { PENDING: colors.warning, IN_PROGRESS: colors.info, COMPLETED: colors.success };

export default function CompliancePage() {
  const [summary, setSummary] = useState<CfComplianceSummary | null>(null);
  const [logs, setLogs] = useState<CfAuditLog[]>([]);
  const [requests, setRequests] = useState<CfDataRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, l, r] = await Promise.all([getComplianceSummary(), listAuditLogs(), listDataRequests()]);
      setSummary(s); setLogs(l); setRequests(r);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function fulfil(id: string) {
    setBusy(id); setError(null);
    try { await fulfilDataRequest(id); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Compliance"
        subtitle="Audit logs, data-subject requests and regulatory posture."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {loading || !summary ? <p style={{ color: colors.muted }}>Loading compliance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Pending KYC" value={String(summary.pendingKyc)} accent={colors.warning} />
            <Kpi label="Pending KYB" value={String(summary.pendingKyb)} accent={colors.warning} />
            <Kpi label="Open data requests" value={String(summary.openDataRequests)} accent={colors.info} />
            <Kpi label="Investment module" value={summary.investmentEnabled ? 'Enabled' : 'Disabled (unlicensed)'} accent={summary.investmentEnabled ? colors.success : colors.muted} />
            <Kpi label="Retention policy" value={`${Math.round(summary.retentionPolicyDays / 365)} yrs`} />
            <Kpi label="Audit events today" value={String(summary.auditEventsToday)} />
          </div>

          {/* Regulatory export */}
          <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Regulatory reports</div>
              <div style={{ fontSize: '0.8rem', color: colors.muted }}>Last export: {new Date(summary.lastRegulatoryExport).toLocaleDateString()}</div>
            </div>
            <Button variant="primary" onClick={() => alert('Export queued (mock).')}>Export regulatory report</Button>
          </Card>

          {/* Data requests */}
          <h2 style={h2()}>Data-subject requests</h2>
          <Card style={{ marginBottom: '1.5rem', padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr>
                <th style={thCell}>Type</th><th style={thCell}>User</th><th style={thCell}>Requested</th><th style={thCell}>Due by</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.type}</strong></td>
                    <td style={tdCell}>{r.userName}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.email}</div></td>
                    <td style={tdCell}>{new Date(r.requestedAt).toLocaleDateString()}</td>
                    <td style={tdCell}>{new Date(r.dueBy).toLocaleDateString()}</td>
                    <td style={tdCell}><Badge text={r.status.replace('_', ' ')} color={DR_BADGE[r.status]} /></td>
                    <td style={tdCell}>{r.status !== 'COMPLETED' && <Button variant="outline" sm disabled={busy === r.id} onClick={() => fulfil(r.id)}>{busy === r.id ? '…' : 'Mark fulfilled'}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Audit log */}
          <h2 style={h2()}>Admin audit log</h2>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr>
                <th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th><th style={thCell}>Target</th><th style={thCell}>IP</th>
              </tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={tdCell}>{new Date(l.createdAt).toLocaleString()}</td>
                    <td style={tdCell}>{l.actor}</td>
                    <td style={tdCell}><code style={{ background: colors.headBg, padding: '0.1rem 0.35rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{l.action}</code></td>
                    <td style={tdCell}>{l.target}</td>
                    <td style={tdCell}><span style={{ color: colors.muted, fontFamily: 'monospace', fontSize: '0.75rem' }}>{l.ip}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card style={{ padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? colors.border}` }}>
      <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 4, color: colors.text }}>{value}</div>
    </Card>
  );
}

const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem', color: colors.text });
