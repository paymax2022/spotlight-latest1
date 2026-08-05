'use client';

import { useEffect, useState } from 'react';
import { listMerchandising } from '@/services/staysAdminService';
import type { MerchandisingSlot } from '@/types/staysAdmin';
import {
  StaysTabs,
  Kpi,
  Badge,
  FilterBar,
  StateBlock,
  select,
  label,
  fmtDate,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function StaysMerchandisingPage() {
  const [rows, setRows] = useState<MerchandisingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placement, setPlacement] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const opts: { placement?: string; status?: string } = {};
      if (placement) opts.placement = placement;
      if (status) opts.status = status;
      setRows(await listMerchandising(Object.keys(opts).length ? opts : undefined));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [placement, status]);

  const activeSlots = rows.filter((s) => s.status === 'active').length;
  const totalImpressions = rows.reduce((s, x) => s + x.impressions, 0);
  const totalClicks = rows.reduce((s, x) => s + x.clicks, 0);

  return (
    <Page>
      <PageHeader
        title="Merchandising & featured slots"
        subtitle="Featured placements across home, city and app surfaces — impressions, clicks and CTR by slot."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="growth" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active slots" value={activeSlots.toLocaleString('en-NG')} accent={colors.success} />
        <Kpi label="Total impressions" value={totalImpressions.toLocaleString('en-NG')} />
        <Kpi label="Total clicks" value={totalClicks.toLocaleString('en-NG')} />
      </div>

      <FilterBar>
        <div>
          <label style={label()}>Placement</label>
          <select style={select()} value={placement} onChange={(e) => setPlacement(e.target.value)}>
            <option value="">All</option>
            <option value="home_hero">Home hero</option>
            <option value="city_top">City top</option>
            <option value="deal_strip">Deal strip</option>
            <option value="app_banner">App banner</option>
          </select>
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="ended">Ended</option>
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No merchandising slots found.">
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Placement</th>
                <th style={thCell}>Property</th>
                <th style={thCell}>Rail</th>
                <th style={thCell}>Position</th>
                <th style={thCell}>Status</th>
                <th style={thCell}>Window</th>
                <th style={thCell}>Impressions</th>
                <th style={thCell}>Clicks</th>
                <th style={thCell}>CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const ctr = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
                return (
                  <tr key={s.id}>
                    <td style={tdCell}>{s.placement.replace(/_/g, ' ')}</td>
                    <td style={tdCell}>{s.property_name}</td>
                    <td style={tdCell}><Badge status={s.rail} /></td>
                    <td style={tdCell}>{s.position}</td>
                    <td style={tdCell}><Badge status={s.status} /></td>
                    <td style={tdCell}>{fmtDate(s.starts_at)} → {fmtDate(s.ends_at)}</td>
                    <td style={tdCell}>{s.impressions.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{s.clicks.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{ctr.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
