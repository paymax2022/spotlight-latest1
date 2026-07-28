'use client';

import { useEffect, useState } from 'react';
import { listMerchandising } from '@/services/staysAdminService';
import type { MerchandisingSlot } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Kpi,
  Badge,
  FilterBar,
  StateBlock,
  btn,
  th,
  td,
  select,
  label,
  fmtDate,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Merchandising & featured slots"
        subtitle="Featured placements across home, city and app surfaces — impressions, clicks and CTR by slot."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="growth" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active slots" value={activeSlots.toLocaleString('en-NG')} accent="#15803d" />
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
                <th style={th()}>Placement</th>
                <th style={th()}>Property</th>
                <th style={th()}>Rail</th>
                <th style={th()}>Position</th>
                <th style={th()}>Status</th>
                <th style={th()}>Window</th>
                <th style={th()}>Impressions</th>
                <th style={th()}>Clicks</th>
                <th style={th()}>CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const ctr = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
                return (
                  <tr key={s.id}>
                    <td style={td()}>{s.placement.replace(/_/g, ' ')}</td>
                    <td style={td()}>{s.property_name}</td>
                    <td style={td()}><Badge status={s.rail} /></td>
                    <td style={td()}>{s.position}</td>
                    <td style={td()}><Badge status={s.status} /></td>
                    <td style={td()}>{fmtDate(s.starts_at)} → {fmtDate(s.ends_at)}</td>
                    <td style={td()}>{s.impressions.toLocaleString('en-NG')}</td>
                    <td style={td()}>{s.clicks.toLocaleString('en-NG')}</td>
                    <td style={td()}>{ctr.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
