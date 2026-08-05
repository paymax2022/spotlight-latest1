'use client';

import { useEffect, useState } from 'react';
import { getReconRuns, getReconBreaks, resolveReconBreak } from '@/services/fxAdminService';
import type { ReconRun, ReconBreak } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, moneyFull } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxReconciliationPage() {
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [breaks, setBreaks] = useState<ReconBreak[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { const [r, b] = await Promise.all([getReconRuns(), getReconBreaks()]); setRuns(r); setBreaks(b); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function resolve(id: string, status: ReconBreak['status']) {
    setBusy(id);
    try { await resolveReconBreak(id, status); await load(); } finally { setBusy(null); }
  }

  const openBreaks = breaks.filter((b) => b.status === 'open' || b.status === 'investigating');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reconciliation" subtitle="Daily runs per provider and the break queue." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="reconciliation" />

      <Card title="Recent recon runs">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Date</th><th style={thCell}>Provider</th><th style={thCell}>Matched</th><th style={thCell}>Breaks</th><th style={thCell}>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}>{r.date}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}><strong>{r.provider}</strong></td>
                  <td style={tdCell}>{r.matched.toLocaleString('en-NG')}</td>
                  <td style={{ ...tdCell, color: r.breaks ? colors.warning : colors.success }}>{r.breaks}</td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Break queue (${openBreaks.length} open)`}>
        {breaks.length === 0 ? <p style={{ color: colors.muted }}>No breaks. Ledger and settlement reports agree.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Reference</th><th style={thCell}>Provider</th><th style={thCell}>Type</th><th style={thCell}>Expected</th><th style={thCell}>Actual</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {breaks.map((b) => (
                <tr key={b.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{b.reference}</strong></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{b.provider}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{b.type}</td>
                  <td style={tdCell}>{b.type === 'timing' ? '—' : moneyFull(b.expectedMinor, b.currency)}</td>
                  <td style={tdCell}>{b.type === 'timing' ? '—' : moneyFull(b.actualMinor, b.currency)}</td>
                  <td style={tdCell}><Badge status={b.status} /></td>
                  <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {b.status !== 'resolved' ? (
                      <>
                        {b.status !== 'investigating' ? <Button variant="outline" sm style={{ marginRight: 6 }} disabled={busy === b.id} onClick={() => resolve(b.id, 'investigating')}>Investigate</Button> : null}
                        <Button variant="primary" sm style={{ background: colors.success, borderColor: colors.success, marginRight: 6 }} disabled={busy === b.id} onClick={() => resolve(b.id, 'resolved')}>Resolve</Button>
                        <Button variant="danger" sm disabled={busy === b.id} onClick={() => resolve(b.id, 'escalated')}>Escalate</Button>
                      </>
                    ) : <span style={{ color: colors.muted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Breaks are surfaced here rather than silently absorbed. Spread reconciliation proves margin per corridor.</p>
      </Card>
    </div>
  );
}
