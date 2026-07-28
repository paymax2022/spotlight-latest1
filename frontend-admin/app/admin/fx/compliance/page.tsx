'use client';

import { useEffect, useState } from 'react';
import { getScreeningAlerts, setAlertStatus } from '@/services/fxAdminService';
import type { ScreeningAlert, CaseStatus } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td } from '../_ui';

const SEV_COLOR: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#6b7280' };

export default function FxCompliancePage() {
  const [rows, setRows] = useState<ScreeningAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() { setLoading(true); try { setRows(await getScreeningAlerts()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  async function act(id: string, status: CaseStatus) { setBusy(id); try { await setAlertStatus(id, status); await load(); } finally { setBusy(null); } }

  const open = rows.filter((r) => r.status === 'open' || r.status === 'in_review').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Compliance & Risk" subtitle={`${open} open · sanctions / AML / monitoring queue`} action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="compliance" />

      <Card title="Screening & monitoring queue">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : rows.length === 0 ? <p style={{ color: '#6b7280' }}>Queue is clear.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Customer</th><th style={th()}>Kind</th><th style={th()}>Detail</th><th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{a.customer}</strong>{a.reference ? <div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{a.reference}</div> : null}</td>
                  <td style={{ ...td(), textTransform: 'uppercase', fontSize: '0.75rem' }}>{a.kind.replace('_', ' ')}</td>
                  <td style={{ ...td(), maxWidth: 280 }}>{a.detail}</td>
                  <td style={{ ...td(), color: SEV_COLOR[a.severity], fontWeight: 600, textTransform: 'capitalize' }}>{a.severity}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.status !== 'cleared' && a.status !== 'blocked' && a.status !== 'sar_filed' ? (
                      <>
                        <button disabled={busy === a.id} onClick={() => act(a.id, 'cleared')} style={{ ...btnPrimary('#16a34a'), marginRight: 6 }}>Clear</button>
                        <button disabled={busy === a.id} onClick={() => act(a.id, 'blocked')} style={{ ...btnPrimary('#dc2626'), marginRight: 6 }}>Block</button>
                        <button disabled={busy === a.id} onClick={() => act(a.id, 'sar_filed')} style={btn()}>File SAR</button>
                      </>
                    ) : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>A <code>compliance_block</code> is a first-class quote/transfer outcome. All decisions are audit-logged with actor and timestamp.</p>
      </Card>
    </div>
  );
}
