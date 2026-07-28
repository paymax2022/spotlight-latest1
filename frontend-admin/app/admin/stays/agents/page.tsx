'use client';

import { useEffect, useState } from 'react';
import { listAgents, formatNaira } from '@/services/staysAdminService';
import type { Agent } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Kpi,
  Badge,
  StateBlock,
  FilterBar,
  btn,
  th,
  td,
  label,
  select,
} from '../_ui';

const STATUSES = ['active', 'suspended', 'pending'];

export default function StaysAgentsPage() {
  const [rows, setRows] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listAgents(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const activeCount = rows.filter((r) => r.status === 'active').length;
  const totalGmv = rows.reduce((sum, r) => sum + r.gmv_30d_kobo, 0);
  const totalUnpaid = rows.reduce((sum, r) => sum + r.commission_unpaid_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Agent management & commissions"
        subtitle="Travel agents and resellers booking on Paymax Stays — performance, tier and commission accruals across a 30-day window."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="trust" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active agents" value={activeCount.toLocaleString('en-NG')} accent="#15803d" />
        <Kpi label="Total GMV (30d)" value={formatNaira(totalGmv)} />
        <Kpi label="Unpaid commission" value={formatNaira(totalUnpaid)} sub="Across all agents" accent={totalUnpaid > 0 ? '#9a3412' : undefined} />
      </div>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No agents found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Agent code</th>
              <th style={th()}>Name</th>
              <th style={th()}>Status</th>
              <th style={th()}>Tier</th>
              <th style={th()}>Bookings 30d</th>
              <th style={th()}>GMV 30d</th>
              <th style={th()}>Rate</th>
              <th style={th()}>Earned</th>
              <th style={th()}>Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.agent_code}</code></td>
                <td style={td()}>{r.name_masked}</td>
                <td style={td()}><Badge status={r.status} /></td>
                <td style={td()}>{r.tier}</td>
                <td style={td()}>{r.bookings_30d.toLocaleString('en-NG')}</td>
                <td style={td()}>{formatNaira(r.gmv_30d_kobo)}</td>
                <td style={td()}>{r.commission_rate_pct}%</td>
                <td style={td()}>{formatNaira(r.commission_earned_kobo)}</td>
                <td style={{ ...td(), color: r.commission_unpaid_kobo > 0 ? '#9a3412' : '#374151', fontWeight: r.commission_unpaid_kobo > 0 ? 700 : 400 }}>{formatNaira(r.commission_unpaid_kobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateBlock>
    </div>
  );
}
