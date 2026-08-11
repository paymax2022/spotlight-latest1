'use client';

import { useEffect, useState } from 'react';
import { getLoyalty, formatNaira } from '@/services/staysAdminService';
import type { LoyaltyConfig } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Kpi,
  Badge,
  DisclosureNote,
  StateBlock,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Loyalty program"
        subtitle="Paymax Stays Rewards — members, points outstanding, points liability (a real ₦ obligation) and tier earn rates & perks."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
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
              <Kpi label="Program" value={data.program_name} sub={data.enabled ? 'Enabled' : 'Disabled'} accent={colors.primary} />
              <Kpi label="Members" value={data.members.toLocaleString('en-NG')} />
              <Kpi label="Points outstanding" value={data.points_outstanding.toLocaleString('en-NG')} />
              <Kpi label="Points liability" value={formatNaira(data.liability_kobo)} sub="₦ obligation" accent={colors.danger} />
              <Kpi label="Point value" value={formatNaira(data.point_value_kobo)} sub="per point" />
              <Kpi label="Expiry" value={`${data.expiry_months} months`} />
            </div>

            <Card title="Program status">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Badge status={data.enabled ? 'active' : 'disabled'} label={data.enabled ? 'Enabled' : 'Disabled'} />
                <span style={{ fontSize: '0.85rem', color: colors.muted }}>
                  Points expire {data.expiry_months} months after they are earned.
                </span>
              </div>
            </Card>

            <Card title="Tiers">
              {data.tiers.length === 0 ? <p style={{ color: colors.muted }}>No tiers configured.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Tier</th>
                      <th style={thCell}>Threshold (nights)</th>
                      <th style={thCell}>Earn rate</th>
                      <th style={thCell}>Perks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tiers.map((t) => (
                      <tr key={t.tier}>
                        <td style={tdCell}><strong>{t.tier}</strong></td>
                        <td style={tdCell}>{t.threshold_nights.toLocaleString('en-NG')}</td>
                        <td style={tdCell}>{t.earn_rate_pct}%</td>
                        <td style={tdCell}>
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
    </Page>
  );
}
