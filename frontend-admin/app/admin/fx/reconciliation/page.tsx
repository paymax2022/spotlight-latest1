'use client';

import { useEffect, useState } from 'react';
import { getReconRuns, getReconBreaks, resolveReconBreak } from '@/services/fxAdminService';
import type { ReconRun, ReconBreak } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td, moneyFull } from '../_ui';

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
      <PageHeader title="Reconciliation" subtitle="Daily runs per provider and the break queue." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="reconciliation" />

      <Card title="Recent recon runs">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Date</th><th style={th()}>Provider</th><th style={th()}>Matched</th><th style={th()}>Breaks</th><th style={th()}>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}>{r.date}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}><strong>{r.provider}</strong></td>
                  <td style={td()}>{r.matched.toLocaleString('en-NG')}</td>
                  <td style={{ ...td(), color: r.breaks ? '#d97706' : '#16a34a' }}>{r.breaks}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Break queue (${openBreaks.length} open)`}>
        {breaks.length === 0 ? <p style={{ color: '#6b7280' }}>No breaks. Ledger and settlement reports agree.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Reference</th><th style={th()}>Provider</th><th style={th()}>Type</th><th style={th()}>Expected</th><th style={th()}>Actual</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {breaks.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{b.reference}</strong></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{b.provider}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{b.type}</td>
                  <td style={td()}>{b.type === 'timing' ? '—' : moneyFull(b.expectedMinor, b.currency)}</td>
                  <td style={td()}>{b.type === 'timing' ? '—' : moneyFull(b.actualMinor, b.currency)}</td>
                  <td style={td()}><Badge status={b.status} /></td>
                  <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {b.status !== 'resolved' ? (
                      <>
                        {b.status !== 'investigating' ? <button disabled={busy === b.id} onClick={() => resolve(b.id, 'investigating')} style={{ ...btn(), marginRight: 6 }}>Investigate</button> : null}
                        <button disabled={busy === b.id} onClick={() => resolve(b.id, 'resolved')} style={{ ...btnPrimary('#16a34a'), marginRight: 6 }}>Resolve</button>
                        <button disabled={busy === b.id} onClick={() => resolve(b.id, 'escalated')} style={btnPrimary('#dc2626')}>Escalate</button>
                      </>
                    ) : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>Breaks are surfaced here rather than silently absorbed. Spread reconciliation proves margin per corridor.</p>
      </Card>
    </div>
  );
}
