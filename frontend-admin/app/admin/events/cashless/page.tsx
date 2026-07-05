'use client';

import { useEffect, useState } from 'react';
import { getCashlessFloat, formatNaira } from '@/services/eventsAdminService';
import type { CashlessFloat } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, fmtDate } from '../_ui';

export default function CashlessPage() {
  const [data, setData] = useState<CashlessFloat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getCashlessFloat()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Cashless float & liability" subtitle="Closed-loop event-wallet float, outstanding customer liability, and residual-refund tracking per event (NL-3)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="cashless" />
      <DisclosureNote>
        <strong>NL-3 — closed-loop.</strong> Event-wallet value is spendable only inside the event;
        there is no open-loop cash-out. At close, unspent balance (residual) MUST be refunded to the
        customer&apos;s funding wallet. Liability = loaded − spent. The ledger projection (NL-8) is
        reconciled against custody float; any delta is a recon break.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No cashless data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total loaded" value={formatNaira(data.total_loaded_kobo)} accent="#0e7490" />
              <Kpi label="Total spent" value={formatNaira(data.total_spent_kobo)} />
              <Kpi label="Outstanding liability" value={formatNaira(data.total_liability_kobo)} sub="Owed back to customers" accent={data.total_liability_kobo > 0 ? '#9a3412' : undefined} />
              <Kpi label="Residual pending" value={formatNaira(data.total_residual_pending_kobo)} sub="NL-3 — refund at close" accent={data.total_residual_pending_kobo > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Ledger balance" value={formatNaira(data.ledger_balance_kobo)} sub="Projection (NL-8)" />
              <Kpi label="Custody balance" value={formatNaira(data.custody_balance_kobo)} sub="Bank/VA backing" />
              <Kpi label="Recon delta" value={formatNaira(data.delta_kobo)} sub="custody − ledger" accent={data.delta_kobo !== 0 ? '#b91c1c' : '#15803d'} />
            </div>

            <Card title={`Per-event float (as of ${fmtDate(data.generated_at)})`}>
              <StateBlock loading={false} error={null} empty={data.lines.length === 0} emptyText="No event wallets.">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Event</th><th style={th()}>Wallet</th><th style={th()}>Loaded</th><th style={th()}>Spent</th>
                    <th style={th()}>Liability</th><th style={th()}>Residual refunded</th><th style={th()}>Residual pending</th><th style={th()}>Closed</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.event_id}>
                        <td style={td()}>{l.event_title}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{l.event_id}</div></td>
                        <td style={td()}><Badge status={l.wallet_status} /></td>
                        <td style={td()}>{formatNaira(l.loaded_kobo)}</td>
                        <td style={td()}>{formatNaira(l.spent_kobo)}</td>
                        <td style={td()}>{formatNaira(l.liability_kobo)}</td>
                        <td style={td()}>{formatNaira(l.residual_refunded_kobo)}</td>
                        <td style={td()}>
                          <span style={{ color: l.residual_pending_kobo > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>{formatNaira(l.residual_pending_kobo)}</span>
                          {l.wallet_status === 'closed' && l.residual_pending_kobo > 0 && <div style={{ marginTop: 4 }}><Badge status="flagged" label="refund due" /></div>}
                        </td>
                        <td style={td()}>{l.closed_at ? fmtDate(l.closed_at) : '—'}</td>
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
