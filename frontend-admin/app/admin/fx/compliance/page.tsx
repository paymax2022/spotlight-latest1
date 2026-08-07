'use client';

import { useEffect, useState } from 'react';
import { getScreeningAlerts, setAlertStatus } from '@/services/fxAdminService';
import type { ScreeningAlert, CaseStatus } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SEV_COLOR: Record<string, string> = { high: colors.danger, medium: colors.warning, low: colors.muted };

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
      <PageHeader title="Compliance & Risk" subtitle={`${open} open · sanctions / AML / monitoring queue`} action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="compliance" />

      <Card title="Screening & monitoring queue">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : rows.length === 0 ? <p style={{ color: colors.muted }}>Queue is clear.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Customer</th><th style={thCell}>Kind</th><th style={thCell}>Detail</th><th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{a.customer}</strong>{a.reference ? <div style={{ color: colors.muted, fontSize: '0.78rem' }}>{a.reference}</div> : null}</td>
                  <td style={{ ...tdCell, textTransform: 'uppercase', fontSize: '0.75rem' }}>{a.kind.replace('_', ' ')}</td>
                  <td style={{ ...tdCell, maxWidth: 280 }}>{a.detail}</td>
                  <td style={{ ...tdCell, color: SEV_COLOR[a.severity], fontWeight: 600, textTransform: 'capitalize' }}>{a.severity}</td>
                  <td style={tdCell}><Badge status={a.status} /></td>
                  <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.status !== 'cleared' && a.status !== 'blocked' && a.status !== 'sar_filed' ? (
                      <>
                        <Button variant="primary" sm style={{ background: colors.success, borderColor: colors.success, marginRight: 6 }} disabled={busy === a.id} onClick={() => act(a.id, 'cleared')}>Clear</Button>
                        <Button variant="danger" sm style={{ marginRight: 6 }} disabled={busy === a.id} onClick={() => act(a.id, 'blocked')}>Block</Button>
                        <Button variant="outline" sm disabled={busy === a.id} onClick={() => act(a.id, 'sar_filed')}>File SAR</Button>
                      </>
                    ) : <span style={{ color: colors.muted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>A <code>compliance_block</code> is a first-class quote/transfer outcome. All decisions are audit-logged with actor and timestamp.</p>
      </Card>
    </div>
  );
}
