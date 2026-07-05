'use client';

import { useEffect, useState } from 'react';
import { listCommission, formatNaira } from '@/services/staysAdminService';
import type { CommissionEntry, SourceRail } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Kpi, Badge, FilterBar, btn, th, td, label, select, timeAgo, StateBlock, DisclosureNote } from '../_ui';

const RAILS: SourceRail[] = ['BEDBANK', 'DIRECT'];
const SOURCES: CommissionEntry['source'][] = ['markup', 'direct_commission', 'net_rate_margin'];

export default function StaysCommissionPage() {
  const [rows, setRows] = useState<CommissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rail, setRail] = useState('');
  const [source, setSource] = useState('');
  const [reconciled, setReconciled] = useState(''); // '' | 'yes' | 'no'

  function reconciledOpt(): boolean | undefined {
    if (reconciled === 'yes') return true;
    if (reconciled === 'no') return false;
    return undefined;
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listCommission({ rail: rail || undefined, source: source || undefined, reconciled: reconciledOpt() }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [rail, source, reconciled]);

  const totalCommission = rows.filter((r) => !r.reversed).reduce((sum, r) => sum + r.amount_kobo, 0);
  const reconciledCount = rows.filter((r) => r.reconciled).length;
  const unreconciledCount = rows.filter((r) => !r.reconciled).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Commission ledger"
        subtitle="Revenue recognised per reservation — markup, direct-rail commission and net-rate margin. Money is ₦ kobo; reversed entries shown."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Commission is tracked on a <strong>separate revenue ledger account</strong> (revenue_ledger_ref). Reversed entries are retained for audit — they are excluded from the total commission KPI but remain visible in the table.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total commission" value={formatNaira(totalCommission)} sub="Non-reversed entries" accent="#15803d" />
        <Kpi label="Reconciled" value={reconciledCount.toLocaleString('en-NG')} accent="#15803d" />
        <Kpi label="Unreconciled" value={unreconciledCount.toLocaleString('en-NG')} accent={unreconciledCount > 0 ? '#9a3412' : undefined} />
      </div>

      <Card title="Filters">
        <FilterBar>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Rail</label>
            <select style={select()} value={rail} onChange={(e) => setRail(e.target.value)}>
              <option value="">All rails</option>
              {RAILS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={label()}>Source</label>
            <select style={select()} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Reconciled</label>
            <select style={select()} value={reconciled} onChange={(e) => setReconciled(e.target.value)}>
              <option value="">All</option>
              <option value="yes">Reconciled</option>
              <option value="no">Unreconciled</option>
            </select>
          </div>
        </FilterBar>
      </Card>

      <Card title={`Commission entries${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No commission entries match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>ID</th>
                  <th style={th()}>Reservation</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>Supplier</th>
                  <th style={th()}>Source</th>
                  <th style={th()}>Amount</th>
                  <th style={th()}>Basis</th>
                  <th style={th()}>Ledger ref</th>
                  <th style={th()}>Reconciled</th>
                  <th style={th()}>Reversed</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.reversed ? { opacity: 0.7 } : undefined}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.reservation_id}</code></td>
                    <td style={td()}><Badge status={r.rail} /></td>
                    <td style={td()}>{r.supplier_code}</td>
                    <td style={td()}><Badge status="normal" label={r.source.replace(/_/g, ' ')} /></td>
                    <td style={{ ...td(), fontWeight: 600, textDecoration: r.reversed ? 'line-through' : undefined }}>{formatNaira(r.amount_kobo)}</td>
                    <td style={{ ...td(), maxWidth: 220 }}>{r.basis}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.revenue_ledger_ref}</code></td>
                    <td style={td()}><Badge status={r.reconciled ? 'reconciled' : 'pending'} label={r.reconciled ? 'Yes' : 'No'} /></td>
                    <td style={td()}>{r.reversed ? <Badge status="reversed" label="Reversed" /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
