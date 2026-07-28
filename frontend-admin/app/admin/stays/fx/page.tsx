'use client';

import { useEffect, useState } from 'react';
import { getFX } from '@/services/staysAdminService';
import type { FxConfig } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock, DisclosureNote } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="FX & currency config"
        subtitle="Controlled conversion rates for cross-currency supplier prices. Mid-rate, spreads and the applied rate used at booking time."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
              <Kpi label="Auto-update" value={data.auto_update ? 'On' : 'Off'} accent={data.auto_update ? '#15803d' : '#9a3412'} />
              <Kpi label="Rate TTL" value={`${data.rate_ttl_minutes} min`} sub="Cache freshness window" />
            </div>

            <Card title={`Rates (${data.rates.length})`}>
              {data.rates.length === 0 ? <p style={{ color: '#6b7280' }}>No FX rates configured.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th()}>Pair</th>
                        <th style={th()}>Mid rate</th>
                        <th style={th()}>Buy spread</th>
                        <th style={th()}>Sell spread</th>
                        <th style={th()}>Applied rate</th>
                        <th style={th()}>Source</th>
                        <th style={th()}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rates.map((r) => (
                        <tr key={r.pair}>
                          <td style={td()}><Badge status="normal" label={r.pair} /></td>
                          <td style={td()}>{r.mid_rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={td()}>{r.buy_spread_pct.toFixed(2)}%</td>
                          <td style={td()}>{r.sell_spread_pct.toFixed(2)}%</td>
                          <td style={{ ...td(), fontWeight: 600 }}>{r.applied_rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={td()}>{r.source}</td>
                          <td style={td()}>{timeAgo(r.updated_at)}</td>
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
    </div>
  );
}
