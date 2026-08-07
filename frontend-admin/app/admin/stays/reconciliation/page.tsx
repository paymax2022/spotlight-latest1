'use client';

import { useEffect, useState } from 'react';
import { getReconciliation, resolveBreak, formatNaira } from '@/services/staysAdminService';
import type { ReconciliationSummary, ReconciliationBreak, BreakStatus, SupplierCode } from '@/types/staysAdmin';
import { StaysTabs, Kpi, Badge, FilterBar, label, select, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell, tint } from '@/components/ui/vuexy';

const STATUSES: BreakStatus[] = ['open', 'investigating', 'resolved'];
const BREAK_TYPES: ReconciliationBreak['break_type'][] = ['net_rate', 'commission', 'refund', 'payout', 'missing_statement'];
const SUPPLIERS: SupplierCode[] = ['ratehawk', 'zentrumhub', 'direct'];

export default function StaysReconciliationPage() {
  const [data, setData] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [breakType, setBreakType] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      setData(await getReconciliation({ status: status || undefined, break_type: breakType || undefined, supplier_code: supplier || undefined }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status, breakType, supplier]);

  async function resolve(id: string, newStatus: BreakStatus) {
    setBusyId(id); setError(null);
    try {
      await resolveBreak(id, { resolution: reasons[id]?.trim() || `Marked ${newStatus} by ops`, status: newStatus, note: reasons[id]?.trim() || undefined });
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  const breaks = data?.breaks ?? [];

  return (
    <Page>
      <PageHeader
        title="Reconciliation workbench"
        subtitle="Supplier statement vs Paymax ledger break management (PRD §12). Money is ₦ kobo; supplier rail + currency disclosed per break."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Breaks are differences between <strong>supplier statements</strong> and the <strong>Paymax double-entry ledger</strong>. A negative delta means the supplier billed more than Paymax booked. Resolve only after the variance is explained and any corrective ledger entry posted.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reconciliation data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Open breaks" value={data.open_breaks.toLocaleString('en-NG')} accent={data.open_breaks > 0 ? colors.danger : undefined} />
              <Kpi label="Break value" value={formatNaira(data.break_value_kobo)} sub="Total unresolved variance" />
              <Kpi label="SLA breached" value={data.sla_breached.toLocaleString('en-NG')} accent={data.sla_breached > 0 ? colors.danger : undefined} />
              <Kpi label="Matched (30d)" value={data.matched_30d.toLocaleString('en-NG')} accent={colors.success} />
              <Kpi label="Unmatched statement lines" value={data.unmatched_statement_lines.toLocaleString('en-NG')} sub="Supplier lines w/o ledger match" />
            </div>

            <Card title="Filters">
              <FilterBar>
                <div style={{ minWidth: 180 }}>
                  <label style={label()}>Status</label>
                  <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 180 }}>
                  <label style={label()}>Break type</label>
                  <select style={select()} value={breakType} onChange={(e) => setBreakType(e.target.value)}>
                    <option value="">All types</option>
                    {BREAK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 180 }}>
                  <label style={label()}>Supplier</label>
                  <select style={select()} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                    <option value="">All suppliers</option>
                    {SUPPLIERS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </FilterBar>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: colors.text }}>{`Breaks${breaks.length ? ` (${breaks.length})` : ''}`}</h2>
              </div>
              {breaks.length === 0 ? <p style={{ color: colors.muted }}>No breaks match these filters.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thCell}>ID</th>
                        <th style={thCell}>Supplier</th>
                        <th style={thCell}>Rail</th>
                        <th style={thCell}>Type</th>
                        <th style={thCell}>Reservation</th>
                        <th style={thCell}>Paymax</th>
                        <th style={thCell}>Supplier</th>
                        <th style={thCell}>Delta</th>
                        <th style={thCell}>Currency</th>
                        <th style={thCell}>Status</th>
                        <th style={thCell}>Age</th>
                        <th style={thCell}>SLA</th>
                        <th style={thCell}>Detail</th>
                        <th style={thCell}>Resolve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breaks.map((b) => (
                        <tr key={b.id} style={b.sla_breached ? { background: tint(colors.danger, 0.06) } : undefined}>
                          <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{b.id}</code></td>
                          <td style={tdCell}><Badge status={b.supplier_code} /></td>
                          <td style={tdCell}><Badge status={b.rail} /></td>
                          <td style={tdCell}>{b.break_type.replace(/_/g, ' ')}</td>
                          <td style={tdCell}>{b.reservation_id ? <code style={{ fontSize: '0.78rem' }}>{b.reservation_id}</code> : '—'}</td>
                          <td style={tdCell}>{formatNaira(b.paymax_amount_kobo)}</td>
                          <td style={tdCell}>{formatNaira(b.supplier_amount_kobo)}</td>
                          <td style={{ ...tdCell, color: b.delta_kobo !== 0 ? colors.danger : colors.text, fontWeight: b.delta_kobo !== 0 ? 600 : 400 }}>{formatNaira(b.delta_kobo)}</td>
                          <td style={tdCell}>{b.currency}</td>
                          <td style={tdCell}><Badge status={b.status} /></td>
                          <td style={tdCell}>{b.age_hours}h</td>
                          <td style={tdCell}>{b.sla_breached ? <Badge status="critical" label="Breached" /> : <Badge status="normal" label="OK" />}</td>
                          <td style={{ ...tdCell, maxWidth: 260 }}>{b.detail}</td>
                          <td style={tdCell}>
                            {b.status === 'resolved' ? <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span> : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 180 }}>
                                <Input
                                  placeholder="Resolution note"
                                  value={reasons[b.id] ?? ''}
                                  onChange={(e) => setReasons((m) => ({ ...m, [b.id]: e.target.value }))}
                                />
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                  <Button variant="outline" sm disabled={busyId === b.id} onClick={() => resolve(b.id, 'investigating')}>Investigate</Button>
                                  <Button variant="primary" sm disabled={busyId === b.id} onClick={() => resolve(b.id, 'resolved')}>Resolve</Button>
                                </div>
                              </div>
                            )}
                          </td>
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
    </Page>
  );
}
