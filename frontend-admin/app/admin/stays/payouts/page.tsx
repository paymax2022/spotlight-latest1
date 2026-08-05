'use client';

import { useEffect, useState } from 'react';
import { listPayouts, formatNaira } from '@/services/staysAdminService';
import type { HotelPayout, PayoutStatus } from '@/types/staysAdmin';
import { StaysTabs, Kpi, Badge, FilterBar, label, select, fmtDate, StateBlock, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: PayoutStatus[] = ['scheduled', 'pending', 'paid', 'failed', 'held'];

export default function StaysPayoutsPage() {
  const [rows, setRows] = useState<HotelPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listPayouts({ status: status || undefined }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status]);

  const totalNet = rows.reduce((sum, r) => sum + r.net_payable_kobo, 0);
  const countByStatus = rows.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});

  return (
    <Page>
      <PageHeader
        title="Hotel payouts"
        subtitle="Direct-hotel settlement runs. All payouts are remitted in Naira (₦ kobo). Bank details masked."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="money" />

      <DisclosureNote>
        Hotel payouts are <strong>always settled in Naira</strong> to direct-rail hotels — even when the guest booked a cross-currency supplier price, the net payable to the hotel is converted and remitted in ₦.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total net payable" value={formatNaira(totalNet)} sub={`${rows.length} payout${rows.length === 1 ? '' : 's'}`} accent={colors.primary} />
        {STATUSES.map((s) => (
          <Kpi key={s} label={s} value={(countByStatus[s] ?? 0).toLocaleString('en-NG')} accent={s === 'failed' ? colors.danger : s === 'paid' ? colors.success : undefined} />
        ))}
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
        </FilterBar>
      </Card>

      <Card title={`Payouts${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Reference</th>
                  <th style={thCell}>Hotelier</th>
                  <th style={thCell}>Property</th>
                  <th style={thCell}>Bookings</th>
                  <th style={thCell}>Gross</th>
                  <th style={thCell}>Commission</th>
                  <th style={thCell}>Net payable</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Bank</th>
                  <th style={thCell}>Scheduled</th>
                  <th style={thCell}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>{r.reference}</td>
                    <td style={tdCell}>{r.hotelier_masked}</td>
                    <td style={tdCell}>{r.property_name}</td>
                    <td style={tdCell}>{r.bookings_count.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{formatNaira(r.gross_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>NGN</span></td>
                    <td style={tdCell}>{formatNaira(r.commission_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>NGN</span></td>
                    <td style={{ ...tdCell, fontWeight: 600 }}>{formatNaira(r.net_payable_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>NGN</span></td>
                    <td style={tdCell}><Badge status={r.status} /></td>
                    <td style={tdCell}>{r.bank_masked}</td>
                    <td style={tdCell}>{fmtDate(r.scheduled_for)}</td>
                    <td style={tdCell}>{fmtDate(r.paid_at)}</td>
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
