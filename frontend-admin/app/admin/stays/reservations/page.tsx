'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listReservations, formatNaira } from '@/services/staysAdminService';
import type { ReservationSummary, ReservationState, SourceRail, SupplierCode } from '@/types/staysAdmin';
import { PageHeader, StaysTabs, Card, Badge, FilterBar, btn, th, td, input, label, select, fmtDate, timeAgo, StateBlock } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reservations"
        subtitle="Search and inspect bookings across the bedbank and direct rails. Guest PII is masked; money is in ₦ (kobo minor units), supplier currency is disclosed on each booking."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="reservations" />

      <Card title="Filters">
        <FilterBar>
          <div style={{ minWidth: 200, flex: 1 }}>
            <label style={label()}>Search</label>
            <input style={input()} placeholder="ID, supplier ref, property or guest" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <th style={th()}>ID</th>
                  <th style={th()}>Supplier ref</th>
                  <th style={th()}>Property</th>
                  <th style={th()}>Guest</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Stay</th>
                  <th style={th()}>Rooms</th>
                  <th style={th()}>Gross</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}>
                      <Link href={`/admin/stays/reservations/${r.id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>
                        {r.id}
                      </Link>
                    </td>
                    <td style={td()}>{r.supplier_ref || '—'}</td>
                    <td style={td()}>
                      <div style={{ fontWeight: 600 }}>{r.property_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{r.city}</div>
                    </td>
                    <td style={td()}>{r.guest_masked}</td>
                    <td style={td()}><Badge status={r.rail} /></td>
                    <td style={td()}><Badge status={r.state} /></td>
                    <td style={td()}>{fmtDate(r.check_in)} &rarr; {fmtDate(r.check_out)}</td>
                    <td style={td()}>{r.rooms}</td>
                    <td style={td()}>{formatNaira(r.gross_amount_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{r.currency}</span></td>
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
