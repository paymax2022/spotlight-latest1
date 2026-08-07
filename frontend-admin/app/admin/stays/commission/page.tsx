'use client';

import { useEffect, useState } from 'react';
import { listCommission, formatNaira } from '@/services/staysAdminService';
import type { CommissionEntry, SourceRail } from '@/types/staysAdmin';
import { StaysTabs, Card, Kpi, Badge, FilterBar, label, select, timeAgo, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Commission ledger"
        subtitle="Revenue recognised per reservation — markup, direct-rail commission and net-rate margin. Money is ₦ kobo; reversed entries shown."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Commission is tracked on a <strong>separate revenue ledger account</strong> (revenue_ledger_ref). Reversed entries are retained for audit — they are excluded from the total commission KPI but remain visible in the table.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total commission" value={formatNaira(totalCommission)} sub="Non-reversed entries" accent={colors.success} />
        <Kpi label="Reconciled" value={reconciledCount.toLocaleString('en-NG')} accent={colors.success} />
        <Kpi label="Unreconciled" value={unreconciledCount.toLocaleString('en-NG')} accent={unreconciledCount > 0 ? colors.warning : undefined} />
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
                  <th style={thCell}>ID</th>
                  <th style={thCell}>Reservation</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>Supplier</th>
                  <th style={thCell}>Source</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Basis</th>
                  <th style={thCell}>Ledger ref</th>
                  <th style={thCell}>Reconciled</th>
                  <th style={thCell}>Reversed</th>
                  <th style={thCell}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.reversed ? { opacity: 0.7 } : undefined}>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.reservation_id}</code></td>
                    <td style={tdCell}><Badge status={r.rail} /></td>
                    <td style={tdCell}>{r.supplier_code}</td>
                    <td style={tdCell}><Badge status="normal" label={r.source.replace(/_/g, ' ')} /></td>
                    <td style={{ ...tdCell, fontWeight: 600, textDecoration: r.reversed ? 'line-through' : undefined }}>{formatNaira(r.amount_kobo)}</td>
                    <td style={{ ...tdCell, maxWidth: 220 }}>{r.basis}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.revenue_ledger_ref}</code></td>
                    <td style={tdCell}><Badge status={r.reconciled ? 'reconciled' : 'pending'} label={r.reconciled ? 'Yes' : 'No'} /></td>
                    <td style={tdCell}>{r.reversed ? <Badge status="reversed" label="Reversed" /> : <span style={{ color: colors.muted }}>—</span>}</td>
                    <td style={tdCell}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
