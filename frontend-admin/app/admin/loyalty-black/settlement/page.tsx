'use client';

import { useEffect, useState } from 'react';
import { listPartnerSettlements, formatNaira } from '@/services/blackAdminService';
import type { BlackSettlement } from '@/types/blackAdmin';
import { BlackTabs, Kpi, DisclosureNote, StateBlock, FilterBar, fmtDate } from '../../creators/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'settled':
    case 'reconciled':
      return colors.success;
    case 'investigating':
      return colors.info;
    case 'open':
      return colors.warning;
    default:
      return colors.secondary;
  }
}

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
    <Page>
      <PageHeader title="Partner settlement" subtitle="Per-partner settlement of redeemed Black perks for the current period — gross perk value split into platform-funded vs partner-funded, with the net due to each partner and any reconciliation breaks." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <BlackTabs active="settlement" />
      <DisclosureNote>Settlement reconciles redeemed-perk ledger entries against partner-funded amounts. Breaks must be investigated before a partner is paid. Settlement runs are append-only and audited (NL-12). Amounts shown ₦ (stored as kobo).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No settlement data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total gross perk value" value={formatNaira(data.total_gross_kobo)} accent={colors.primary} />
              <Kpi label="Platform-funded" value={formatNaira(data.total_platform_funded_kobo)} sub="Paymax cost" />
              <Kpi label="Partner-funded" value={formatNaira(data.total_partner_funded_kobo)} />
              <Kpi label="Net due to partners" value={formatNaira(data.total_net_due_kobo)} accent={data.total_net_due_kobo > 0 ? colors.warning : undefined} />
              <Kpi label="Total break" value={formatNaira(data.total_break_kobo)} accent={data.total_break_kobo !== 0 ? colors.danger : colors.success} />
              <Kpi label="Breaks open" value={data.breaks_open.toLocaleString('en-NG')} accent={data.breaks_open > 0 ? colors.danger : undefined} />
            </div>

            <FilterBar>
              <div style={{ minWidth: 220 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
                <Input placeholder="Partner name or line id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="settled">Settled</option>
                  <option value="reconciled">Reconciled</option>
                </select>
              </div>
              <Button variant="outline" onClick={load}>Apply</Button>
            </FilterBar>

            <Card title={`Settlement lines · generated ${fmtDate(data.generated_at)}`} style={{ padding: 0, overflow: 'auto' }}>
              {data.lines.length === 0 ? <p style={{ color: colors.muted, padding: '0 14px 14px' }}>No settlement lines for this filter.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Line</th><th style={thCell}>Partner</th><th style={thCell}>Period</th><th style={thCell}>Redemptions</th>
                    <th style={thCell}>Gross</th><th style={thCell}>Platform-funded</th><th style={thCell}>Partner-funded</th><th style={thCell}>Net due</th><th style={thCell}>Break</th><th style={thCell}>Status</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                        <td style={tdCell}>{r.partner_name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.partner_id}</div></td>
                        <td style={tdCell}>{r.period}</td>
                        <td style={tdCell}>{r.redemptions.toLocaleString('en-NG')}</td>
                        <td style={tdCell}>{formatNaira(r.gross_perk_value_kobo)}</td>
                        <td style={tdCell}>{formatNaira(r.platform_funded_kobo)}</td>
                        <td style={tdCell}>{formatNaira(r.partner_funded_kobo)}</td>
                        <td style={tdCell}><strong>{formatNaira(r.net_due_to_partner_kobo)}</strong></td>
                        <td style={tdCell}><span style={{ color: r.break_kobo !== 0 ? colors.danger : colors.muted, fontWeight: r.break_kobo !== 0 ? 700 : 400 }}>{formatNaira(r.break_kobo)}</span></td>
                        <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
