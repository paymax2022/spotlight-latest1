'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listReservations, formatNaira } from '@/services/staysAdminService';
import type { ReservationSummary, ReservationState, SourceRail, SupplierCode } from '@/types/staysAdmin';
import { StaysTabs, Badge, FilterBar, label, select, fmtDate, timeAgo, StateBlock } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATES: ReservationState[] = [
  'OFFER_SELECTED', 'PREBOOK_OK', 'PAYMENT_HELD', 'BOOKING', 'CONFIRMED',
  'COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOTEL', 'NO_SHOW',
  'BOOK_FAILED', 'PAYMENT_FAILED', 'VOID',
];
const RAILS: SourceRail[] = ['BEDBANK', 'DIRECT'];
const SUPPLIERS: SupplierCode[] = ['ratehawk', 'zentrumhub', 'direct'];

export default function StaysReservationsPage() {
  const [rows, setRows] = useState<ReservationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [rail, setRail] = useState('');
  const [supplier, setSupplier] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listReservations({
        state: state || undefined,
        rail: rail || undefined,
        supplier_code: supplier || undefined,
        q: q || undefined,
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [state, rail, supplier, q]);

  return (
    <Page>
      <PageHeader
        title="Reservations"
        subtitle="Search and inspect bookings across the bedbank and direct rails. Guest PII is masked; money is in ₦ (kobo minor units), supplier currency is disclosed on each booking."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="reservations" />

      <Card title="Filters">
        <FilterBar>
          <div style={{ minWidth: 200, flex: 1 }}>
            <label style={label()}>Search</label>
            <Input placeholder="ID, supplier ref, property or guest" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={label()}>State</label>
            <select style={select()} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Rail</label>
            <select style={select()} value={rail} onChange={(e) => setRail(e.target.value)}>
              <option value="">All rails</option>
              {RAILS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Supplier</label>
            <select style={select()} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">All suppliers</option>
              {SUPPLIERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </FilterBar>
      </Card>

      <Card title={`Results${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reservations match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>ID</th>
                  <th style={thCell}>Supplier ref</th>
                  <th style={thCell}>Property</th>
                  <th style={thCell}>Guest</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>State</th>
                  <th style={thCell}>Stay</th>
                  <th style={thCell}>Rooms</th>
                  <th style={thCell}>Gross</th>
                  <th style={thCell}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>
                      <Link href={`/admin/stays/reservations/${r.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        {r.id}
                      </Link>
                    </td>
                    <td style={tdCell}>{r.supplier_ref || '—'}</td>
                    <td style={tdCell}>
                      <div style={{ fontWeight: 600 }}>{r.property_name}</div>
                      <div style={{ fontSize: '0.75rem', color: colors.muted }}>{r.city}</div>
                    </td>
                    <td style={tdCell}>{r.guest_masked}</td>
                    <td style={tdCell}><Badge status={r.rail} /></td>
                    <td style={tdCell}><Badge status={r.state} /></td>
                    <td style={tdCell}>{fmtDate(r.check_in)} &rarr; {fmtDate(r.check_out)}</td>
                    <td style={tdCell}>{r.rooms}</td>
                    <td style={tdCell}>{formatNaira(r.gross_amount_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>{r.currency}</span></td>
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
