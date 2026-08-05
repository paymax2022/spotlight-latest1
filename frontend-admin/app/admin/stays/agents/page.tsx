'use client';

import { useEffect, useState } from 'react';
import { listAgents, formatNaira } from '@/services/staysAdminService';
import type { Agent } from '@/types/staysAdmin';
import {
  StaysTabs,
  Kpi,
  Badge,
  StateBlock,
  FilterBar,
  label,
  select,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Agent management & commissions"
        subtitle="Travel agents and resellers booking on Paymax Stays — performance, tier and commission accruals across a 30-day window."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="trust" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active agents" value={activeCount.toLocaleString('en-NG')} accent={colors.success} />
        <Kpi label="Total GMV (30d)" value={formatNaira(totalGmv)} />
        <Kpi label="Unpaid commission" value={formatNaira(totalUnpaid)} sub="Across all agents" accent={totalUnpaid > 0 ? colors.warning : undefined} />
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
              <th style={thCell}>Agent code</th>
              <th style={thCell}>Name</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Tier</th>
              <th style={thCell}>Bookings 30d</th>
              <th style={thCell}>GMV 30d</th>
              <th style={thCell}>Rate</th>
              <th style={thCell}>Earned</th>
              <th style={thCell}>Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.agent_code}</code></td>
                <td style={tdCell}>{r.name_masked}</td>
                <td style={tdCell}><Badge status={r.status} /></td>
                <td style={tdCell}>{r.tier}</td>
                <td style={tdCell}>{r.bookings_30d.toLocaleString('en-NG')}</td>
                <td style={tdCell}>{formatNaira(r.gmv_30d_kobo)}</td>
                <td style={tdCell}>{r.commission_rate_pct}%</td>
                <td style={tdCell}>{formatNaira(r.commission_earned_kobo)}</td>
                <td style={{ ...tdCell, color: r.commission_unpaid_kobo > 0 ? colors.warning : colors.text, fontWeight: r.commission_unpaid_kobo > 0 ? 700 : 400 }}>{formatNaira(r.commission_unpaid_kobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateBlock>
    </Page>
  );
}
