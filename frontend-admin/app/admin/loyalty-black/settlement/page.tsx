'use client';

import { useEffect, useState } from 'react';
import { listPartnerSettlements, formatNaira } from '@/services/blackAdminService';
import type { BlackSettlement } from '@/types/blackAdmin';
import { PageHeader, BlackTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate } from '../../creators/_ui';

export default function BlackSettlementPage() {
  const [data, setData] = useState<BlackSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setData(await listPartnerSettlements({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Partner settlement" subtitle="Per-partner settlement of redeemed Black perks for the current period — gross perk value split into platform-funded vs partner-funded, with the net due to each partner and any reconciliation breaks." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <BlackTabs active="settlement" />
      <DisclosureNote>Settlement reconciles redeemed-perk ledger entries against partner-funded amounts. Breaks must be investigated before a partner is paid. Settlement runs are append-only and audited (NL-12). Amounts shown ₦ (stored as kobo).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No settlement data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total gross perk value" value={formatNaira(data.total_gross_kobo)} accent="#340075" />
              <Kpi label="Platform-funded" value={formatNaira(data.total_platform_funded_kobo)} sub="Paymax cost" />
              <Kpi label="Partner-funded" value={formatNaira(data.total_partner_funded_kobo)} />
              <Kpi label="Net due to partners" value={formatNaira(data.total_net_due_kobo)} accent={data.total_net_due_kobo > 0 ? '#9a3412' : undefined} />
              <Kpi label="Total break" value={formatNaira(data.total_break_kobo)} accent={data.total_break_kobo !== 0 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Breaks open" value={data.breaks_open.toLocaleString('en-NG')} accent={data.breaks_open > 0 ? '#b91c1c' : undefined} />
            </div>

            <FilterBar>
              <div style={{ minWidth: 220 }}>
                <label style={label()}>Search</label>
                <input style={input()} placeholder="Partner name or line id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
              </div>
              <div>
                <label style={label()}>Status</label>
                <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="settled">Settled</option>
                  <option value="reconciled">Reconciled</option>
                </select>
              </div>
              <button style={btn()} onClick={load}>Apply</button>
            </FilterBar>

            <Card title={`Settlement lines · generated ${fmtDate(data.generated_at)}`}>
              {data.lines.length === 0 ? <p style={{ color: '#6b7280' }}>No settlement lines for this filter.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Line</th><th style={th()}>Partner</th><th style={th()}>Period</th><th style={th()}>Redemptions</th>
                    <th style={th()}>Gross</th><th style={th()}>Platform-funded</th><th style={th()}>Partner-funded</th><th style={th()}>Net due</th><th style={th()}>Break</th><th style={th()}>Status</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((r) => (
                      <tr key={r.id}>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                        <td style={td()}>{r.partner_name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.partner_id}</div></td>
                        <td style={td()}>{r.period}</td>
                        <td style={td()}>{r.redemptions.toLocaleString('en-NG')}</td>
                        <td style={td()}>{formatNaira(r.gross_perk_value_kobo)}</td>
                        <td style={td()}>{formatNaira(r.platform_funded_kobo)}</td>
                        <td style={td()}>{formatNaira(r.partner_funded_kobo)}</td>
                        <td style={td()}><strong>{formatNaira(r.net_due_to_partner_kobo)}</strong></td>
                        <td style={td()}><span style={{ color: r.break_kobo !== 0 ? '#b91c1c' : '#9ca3af', fontWeight: r.break_kobo !== 0 ? 700 : 400 }}>{formatNaira(r.break_kobo)}</span></td>
                        <td style={td()}><Badge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
