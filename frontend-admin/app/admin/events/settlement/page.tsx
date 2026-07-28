'use client';

import { useEffect, useState } from 'react';
import { getSettlement, resolveSettlementBreak, formatNaira } from '@/services/eventsAdminService';
import type { Settlement, SettlementLine } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, th, td, fmtDate } from '../_ui';

export default function SettlementPage() {
  const [data, setData] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSettlement()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function resolve(l: SettlementLine, action: 'investigate' | 'resolve' | 'reconcile') {
    const note = window.prompt(`${action} settlement break for "${l.event_title}" (${l.id}, break ${formatNaira(l.break_kobo)})? Audited action. Enter a note:`);
    if (note === null) return;
    setBusy(l.id); setMsg(null);
    try {
      const res = await resolveSettlementBreak(l.id, action, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Settlement & reconciliation" subtitle="Per-event settlement (gross, fees, vendor payouts, organiser net, residual refunds) with reconciliation-break resolution." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="settlement" />
      <DisclosureNote>Settlement nets vendor payouts and platform fees from gross. A non-zero break means the ledger projection (NL-8) and custody/settlement don&apos;t tie — investigate before settling. Every resolution posts an immutable audit event (NL-12). Amounts ₦ (kobo).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No settlement data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total gross" value={formatNaira(data.total_gross_kobo)} accent="#340075" />
              <Kpi label="Total fees" value={formatNaira(data.total_fees_kobo)} accent="#15803d" />
              <Kpi label="Organiser net" value={formatNaira(data.total_organiser_net_kobo)} />
              <Kpi label="Vendor payouts" value={formatNaira(data.total_vendor_payouts_kobo)} />
              <Kpi label="Open breaks" value={data.breaks_open.toLocaleString('en-NG')} accent={data.breaks_open > 0 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Break value" value={formatNaira(data.total_break_kobo)} accent={data.total_break_kobo > 0 ? '#b91c1c' : '#15803d'} />
            </div>

            <Card title={`Settlement lines (as of ${fmtDate(data.generated_at)})`}>
              <StateBlock loading={false} error={null} empty={data.lines.length === 0} emptyText="No settlement lines.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Event</th><th style={th()}>Gross</th><th style={th()}>Fees</th><th style={th()}>Vendor payouts</th>
                    <th style={th()}>Organiser net</th><th style={th()}>Residual refunds</th><th style={th()}>Break</th><th style={th()}>Status</th><th style={th()}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={td()}>{l.event_title}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{l.id}</div></td>
                        <td style={td()}>{formatNaira(l.gross_kobo)}</td>
                        <td style={td()}>{formatNaira(l.fees_kobo)}</td>
                        <td style={td()}>{formatNaira(l.vendor_payouts_kobo)}</td>
                        <td style={td()}>{formatNaira(l.organiser_net_kobo)}</td>
                        <td style={td()}>{formatNaira(l.residual_refunds_kobo)}</td>
                        <td style={td()}><span style={{ color: l.break_kobo > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>{formatNaira(l.break_kobo)}</span></td>
                        <td style={td()}><Badge status={l.status} /></td>
                        <td style={td()}>
                          {l.status === 'settled' ? <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span> : (
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              {l.status === 'open' && <button style={btn()} disabled={busy === l.id} onClick={() => resolve(l, 'investigate')}>Investigate</button>}
                              <button style={btn()} disabled={busy === l.id} onClick={() => resolve(l, 'resolve')}>Resolve</button>
                              <button style={btnPrimary()} disabled={busy === l.id} onClick={() => resolve(l, 'reconcile')}>{busy === l.id ? '…' : 'Reconcile'}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StateBlock>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
