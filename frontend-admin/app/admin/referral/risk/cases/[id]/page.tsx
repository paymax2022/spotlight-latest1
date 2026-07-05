'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getCase, executeClawbackOps, formatNaira } from '@/services/referralAdminOpsService';
import type { CaseDetail } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, btnDanger, th, td, timeAgo, StateBlock } from '../../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={data ? `Case ${data.id}` : 'Case'}
        subtitle="Investigation workbench — evidence, linked accounts/devices, decisions & audit trail (A-RSK-03)."
        action={<Link href="/admin/referral/risk" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Dashboard</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Case not found.">
        {data && (
          <>
            <Card title="Case summary" right={<Badge status={data.status === 'investigating' ? 'open' : data.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Kpi label="Subject" value={data.subject_name} sub={data.subject_id} />
                <Kpi label="Severity" value={data.severity} accent={data.severity === 'critical' ? '#b91c1c' : '#9a3412'} />
                <Kpi label="Risk score" value={`${data.risk_score}/100`} accent={data.risk_score >= 70 ? '#b91c1c' : '#9a3412'} />
                <Kpi label="Amount at risk" value={formatNaira(data.amount_at_risk_kobo)} accent="#b91c1c" />
              </div>
              <p style={{ fontSize: '0.85rem', color: '#374151', margin: 0 }}><strong>Reason:</strong> {data.reason}</p>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.25rem' }}>Assigned to: {data.assigned_to ?? 'unassigned'} · opened {timeAgo(data.created_at)}</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={clawback} style={btnDanger()}>{busy ? '…' : 'Execute clawback'}</button>
              </div>
              {msg && <p style={{ color: '#15803d', fontSize: '0.8rem', marginTop: '0.5rem' }}>{msg}</p>}
            </Card>

            <Card title="Linked accounts & devices">
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Accounts ({data.linked_accounts.length})</div>
                  {data.linked_accounts.map((a) => <div key={a} style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}><Link href={`/admin/referral/users/${a}`} style={{ color: '#340075' }}>{a}</Link></div>)}
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Devices ({data.linked_devices.length})</div>
                  {data.linked_devices.map((d) => <div key={d} style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}><code>{d}</code></div>)}
                </div>
              </div>
            </Card>

            <Card title="Evidence">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>When</th><th style={th()}>Kind</th><th style={th()}>Detail</th></tr></thead>
                <tbody>
                  {data.evidence.map((e, i) => (
                    <tr key={i}><td style={td()}>{timeAgo(e.ts)}</td><td style={td()}>{e.kind}</td><td style={td()}>{e.detail}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Audit trail">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th></tr></thead>
                <tbody>
                  {data.audit.map((a, i) => (
                    <tr key={i}><td style={td()}>{timeAgo(a.ts)}</td><td style={td()}>{a.actor}</td><td style={td()}>{a.action}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
