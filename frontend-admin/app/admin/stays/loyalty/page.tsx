'use client';

import { useEffect, useState } from 'react';
import { getLoyalty, formatNaira } from '@/services/staysAdminService';
import type { LoyaltyConfig } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Kpi,
  Badge,
  DisclosureNote,
  StateBlock,
  btn,
  th,
  td,
} from '../_ui';

export default function StaysLoyaltyPage() {
  const [data, setData] = useState<LoyaltyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getLoyalty()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Loyalty program"
        subtitle="Paymax Stays Rewards — members, points outstanding, points liability (a real ₦ obligation) and tier earn rates & perks."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="growth" />

      <DisclosureNote>
        Points outstanding are a real ₦ obligation. The liability shown here is points_outstanding ×
        point value and must be tracked, accrued and reconciled like any other payable.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No loyalty configuration available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Program" value={data.program_name} sub={data.enabled ? 'Enabled' : 'Disabled'} accent="#340075" />
              <Kpi label="Members" value={data.members.toLocaleString('en-NG')} />
              <Kpi label="Points outstanding" value={data.points_outstanding.toLocaleString('en-NG')} />
              <Kpi label="Points liability" value={formatNaira(data.liability_kobo)} sub="₦ obligation" accent="#b91c1c" />
              <Kpi label="Point value" value={formatNaira(data.point_value_kobo)} sub="per point" />
              <Kpi label="Expiry" value={`${data.expiry_months} months`} />
            </div>

            <Card title="Program status">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Badge status={data.enabled ? 'active' : 'disabled'} label={data.enabled ? 'Enabled' : 'Disabled'} />
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                  Points expire {data.expiry_months} months after they are earned.
                </span>
              </div>
            </Card>

            <Card title="Tiers">
              {data.tiers.length === 0 ? <p style={{ color: '#6b7280' }}>No tiers configured.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Tier</th>
                      <th style={th()}>Threshold (nights)</th>
                      <th style={th()}>Earn rate</th>
                      <th style={th()}>Perks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tiers.map((t) => (
                      <tr key={t.tier}>
                        <td style={td()}><strong>{t.tier}</strong></td>
                        <td style={td()}>{t.threshold_nights.toLocaleString('en-NG')}</td>
                        <td style={td()}>{t.earn_rate_pct}%</td>
                        <td style={td()}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {t.perks.map((p) => <Badge key={p} status="info" label={p} />)}
                          </div>
                        </td>
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
