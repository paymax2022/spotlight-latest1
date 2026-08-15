'use client';

import { useEffect, useState } from 'react';
import { getFX } from '@/services/staysAdminService';
import type { FxConfig } from '@/types/staysAdmin';
import { StaysTabs, Card, Kpi, Badge, timeAgo, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function StaysFxPage() {
  const [data, setData] = useState<FxConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFX()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="FX & currency config"
        subtitle="Controlled conversion rates for cross-currency supplier prices. Mid-rate, spreads and the applied rate used at booking time."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Every supplier price carries an explicit currency. Cross-currency conversion to ₦ uses <strong>these controlled rates — never a silent or implicit conversion</strong> (PRD §5 FX integrity). The applied rate (mid + sell spread) is what the guest is charged.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No FX configuration available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Base currency" value={data.base_currency} />
              <Kpi label="Display currency" value={data.display_currency} />
              <Kpi label="Auto-update" value={data.auto_update ? 'On' : 'Off'} accent={data.auto_update ? colors.success : colors.warning} />
              <Kpi label="Rate TTL" value={`${data.rate_ttl_minutes} min`} sub="Cache freshness window" />
            </div>

            <Card title={`Rates (${data.rates.length})`}>
              {data.rates.length === 0 ? <p style={{ color: colors.muted }}>No FX rates configured.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thCell}>Pair</th>
                        <th style={thCell}>Mid rate</th>
                        <th style={thCell}>Buy spread</th>
                        <th style={thCell}>Sell spread</th>
                        <th style={thCell}>Applied rate</th>
                        <th style={thCell}>Source</th>
                        <th style={thCell}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rates.map((r) => (
                        <tr key={r.pair}>
                          <td style={tdCell}><Badge status="normal" label={r.pair} /></td>
                          <td style={tdCell}>{r.mid_rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={tdCell}>{r.buy_spread_pct.toFixed(2)}%</td>
                          <td style={tdCell}>{r.sell_spread_pct.toFixed(2)}%</td>
                          <td style={{ ...tdCell, fontWeight: 600 }}>{r.applied_rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={tdCell}>{r.source}</td>
                          <td style={tdCell}>{timeAgo(r.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
