'use client';

import { useCallback, useEffect, useState } from 'react';
import { getComplianceSummary, listAuditLogs, listDataRequests, fulfilDataRequest } from '@/services/crowdfundingAdminService';
import type { CfComplianceSummary, CfAuditLog, CfDataRequest } from '@/types/crowdfunding';

const DR_BADGE: Record<string, string> = { PENDING: '#d97706', IN_PROGRESS: '#1d4ed8', COMPLETED: '#16a34a' };

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Compliance</h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>Audit logs, data-subject requests and regulatory posture.</p>
        </div>
        <button onClick={load} style={btn()}>Refresh</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

      {loading || !summary ? <p style={{ color: '#6b7280' }}>Loading compliance…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Pending KYC" value={String(summary.pendingKyc)} accent="#d97706" />
            <Kpi label="Pending KYB" value={String(summary.pendingKyb)} accent="#d97706" />
            <Kpi label="Open data requests" value={String(summary.openDataRequests)} accent="#1d4ed8" />
            <Kpi label="Investment module" value={summary.investmentEnabled ? 'Enabled' : 'Disabled (unlicensed)'} accent={summary.investmentEnabled ? '#16a34a' : '#6b7280'} />
            <Kpi label="Retention policy" value={`${Math.round(summary.retentionPolicyDays / 365)} yrs`} />
            <Kpi label="Audit events today" value={String(summary.auditEventsToday)} />
          </div>

          {/* Regulatory export */}
          <div style={{ ...card(), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Regulatory reports</div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Last export: {new Date(summary.lastRegulatoryExport).toLocaleDateString()}</div>
            </div>
            <button style={primaryBtn('#1d4ed8')} onClick={() => alert('Export queued (mock).')}>Export regulatory report</button>
          </div>

          {/* Data requests */}
          <h2 style={h2()}>Data-subject requests</h2>
          <div style={{ ...card(), marginBottom: '1.5rem', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Type</th><th style={th()}>User</th><th style={th()}>Requested</th><th style={th()}>Due by</th><th style={th()}>Status</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{r.type}</strong></td>
                    <td style={td()}>{r.userName}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.email}</div></td>
                    <td style={td()}>{new Date(r.requestedAt).toLocaleDateString()}</td>
                    <td style={td()}>{new Date(r.dueBy).toLocaleDateString()}</td>
                    <td style={td()}><span style={badge(DR_BADGE[r.status])}>{r.status.replace('_', ' ')}</span></td>
                    <td style={td()}>{r.status !== 'COMPLETED' && <button disabled={busy === r.id} onClick={() => fulfil(r.id)} style={btn()}>{busy === r.id ? '…' : 'Mark fulfilled'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Audit log */}
          <h2 style={h2()}>Admin audit log</h2>
          <div style={{ ...card(), padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th><th style={th()}>Target</th><th style={th()}>IP</th>
              </tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}>{new Date(l.createdAt).toLocaleString()}</td>
                    <td style={td()}>{l.actor}</td>
                    <td style={td()}><code style={{ background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{l.action}</code></td>
                    <td style={td()}>{l.target}</td>
                    <td style={td()}><span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: '0.75rem' }}>{l.ip}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...card(), padding: '0.9rem 1rem', borderLeft: `3px solid ${accent ?? '#e5e7eb'}` }}>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 4, color: '#111827' }}>{value}</div>
    </div>
  );
}

const card = (): React.CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
const btn = (): React.CSSProperties => ({ padding: '0.35rem 0.7rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' });
const primaryBtn = (bg: string): React.CSSProperties => ({ padding: '0.45rem 1rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' });
const h2 = (): React.CSSProperties => ({ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' });
const th = (): React.CSSProperties => ({ padding: '0.5rem 0.75rem', fontWeight: 600 });
const td = (): React.CSSProperties => ({ padding: '0.55rem 0.75rem', color: '#374151' });
function badge(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
}
