'use client';

import { useEffect, useState } from 'react';
import { listPromotions, formatNaira } from '@/services/staysAdminService';
import type { Promotion } from '@/types/staysAdmin';
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

function formatValue(p: Promotion): string {
  switch (p.type) {
    case 'percent_off': return `${p.value}%`;
    case 'cashback': return `${p.value}%`;
    case 'free_night': return `${p.value} free night${p.value === 1 ? '' : 's'}`;
    case 'amount_off': return formatNaira(p.value * 100);
    default: return String(p.value);
  }
}

export default function StaysPromotionsPage() {
  const [rows, setRows] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPromotions(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  const activeCount = rows.filter((p) => p.status === 'active').length;
  const totalSpent = rows.reduce((s, p) => s + p.spent_kobo, 0);
  const totalBudget = rows.reduce((s, p) => s + p.budget_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Promotions & campaigns"
        subtitle="Discount codes, cashback and free-night campaigns with budget utilization tracking."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="growth" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Active campaigns" value={activeCount.toLocaleString('en-NG')} accent="#15803d" />
        <Kpi label="Total spent" value={formatNaira(totalSpent)} />
        <Kpi label="Total budget" value={formatNaira(totalBudget)} />
      </div>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No promotions found.">
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Code</th>
                <th style={th()}>Name</th>
                <th style={th()}>Type</th>
                <th style={th()}>Value</th>
                <th style={th()}>Scope</th>
                <th style={th()}>Status</th>
                <th style={th()}>Redemptions</th>
                <th style={th()}>Spent / Budget</th>
                <th style={th()}>Window</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const util = p.budget_kobo > 0 ? p.spent_kobo / p.budget_kobo : 0;
                const utilPct = Math.min(util * 100, 100);
                return (
                  <tr key={p.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.code}</code></td>
                    <td style={td()}>{p.name}</td>
                    <td style={td()}><Badge status={p.type} label={p.type.replace(/_/g, ' ')} /></td>
                    <td style={td()}>{formatValue(p)}</td>
                    <td style={td()}>{p.scope}</td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}>{p.redemptions.toLocaleString('en-NG')}</td>
                    <td style={td()}>
                      <div style={{ fontSize: '0.8rem' }}>{formatNaira(p.spent_kobo)} / {formatNaira(p.budget_kobo)}</div>
                      <div style={{ marginTop: 4, height: 6, width: 140, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${utilPct}%`, background: util >= 0.9 ? '#b91c1c' : '#340075', borderRadius: 3 }} title={`${(util * 100).toFixed(1)}% used`} />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>{(util * 100).toFixed(1)}% used</div>
                    </td>
                    <td style={td()}>{fmtDate(p.starts_at)} → {fmtDate(p.ends_at)}</td>
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
