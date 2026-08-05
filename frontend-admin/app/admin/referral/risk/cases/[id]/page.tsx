'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getCase, executeClawbackOps, formatNaira } from '@/services/referralAdminOpsService';
import type { CaseDetail } from '@/types/referralAdminOps';
import { timeAgo } from '../../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function badgeColor(status: string): string {
  switch (status) {
    case 'critical':
      return colors.danger;
    case 'resolved': case 'closed':
      return colors.success;
    default:
      return colors.warning;
  }
}

export default function CaseWorkbenchPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getCase(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function clawback() {
    if (!data) return;
    setBusy(true); setMsg(null);
    try {
      await executeClawbackOps(data.subject_id, `Case ${data.id}: ${data.reason}`);
      setMsg('Clawback executed — reversing ledger entries posted, audit event emitted.');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        title={data ? `Case ${data.id}` : 'Case'}
        subtitle="Investigation workbench — evidence, linked accounts/devices, decisions & audit trail (A-RSK-03)."
        actions={<Link href="/admin/referral/risk" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Dashboard</Link>}
      />

      {loading ? <p style={{ color: colors.muted }}>Loading…</p>
        : error ? <p style={{ color: colors.danger }}>{error}</p>
        : !data ? <p style={{ color: colors.muted }}>Case not found.</p>
        : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Case summary</h2>
                <Badge text={data.status === 'investigating' ? 'open' : data.status} color={badgeColor(data.status === 'investigating' ? 'open' : data.status)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>
                <Kpi label="Subject" value={data.subject_name} sub={data.subject_id} />
                <Kpi label="Severity" value={data.severity} accent={data.severity === 'critical' ? colors.danger : colors.warning} />
                <Kpi label="Risk score" value={`${data.risk_score}/100`} accent={data.risk_score >= 70 ? colors.danger : colors.warning} />
                <Kpi label="Amount at risk" value={formatNaira(data.amount_at_risk_kobo)} accent={colors.danger} />
              </div>
              <p style={{ fontSize: 14, color: colors.text, margin: 0 }}><strong>Reason:</strong> {data.reason}</p>
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Assigned to: {data.assigned_to ?? 'unassigned'} · opened {timeAgo(data.created_at)}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <Button variant="danger" disabled={busy} onClick={clawback}>{busy ? '…' : 'Execute clawback'}</Button>
              </div>
              {msg && <p style={{ color: colors.success, fontSize: 13, marginTop: 8 }}>{msg}</p>}
            </Card>

            <Card title="Linked accounts & devices" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700, textTransform: 'uppercase' }}>Accounts ({data.linked_accounts.length})</div>
                  {data.linked_accounts.map((a) => <div key={a} style={{ fontSize: 14, marginTop: 3 }}><Link href={`/admin/referral/users/${a}`}>{a}</Link></div>)}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, fontWeight: 700, textTransform: 'uppercase' }}>Devices ({data.linked_devices.length})</div>
                  {data.linked_devices.map((d) => <div key={d} style={{ fontSize: 14, marginTop: 3 }}><code>{d}</code></div>)}
                </div>
              </div>
            </Card>

            <Card title="Evidence" style={{ marginBottom: 16 }}>
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Kind</th><th style={thCell}>Detail</th></tr></thead>
                  <tbody>
                    {data.evidence.map((e, i) => (
                      <tr key={i}><td style={tdCell}>{timeAgo(e.ts)}</td><td style={tdCell}>{e.kind}</td><td style={tdCell}>{e.detail}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Audit trail">
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th></tr></thead>
                  <tbody>
                    {data.audit.map((a, i) => (
                      <tr key={i}><td style={tdCell}>{timeAgo(a.ts)}</td><td style={tdCell}>{a.actor}</td><td style={tdCell}>{a.action}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
    </Page>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '13px 15px', background: colors.card }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
