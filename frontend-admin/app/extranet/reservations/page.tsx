'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listReservations, formatNaira } from '@/services/staysExtranetService';
import type { ReservationSummary } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, select, input, label, th, td, fmtDate } from '../_ui';

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export default function ReservationsPage() {
  const [rows, setRows] = useState<ReservationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReservations()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const today = todayStr();
  const arrivals = rows.filter((r) => r.check_in === today && ['confirmed', 'pending'].includes(r.status)).length;
  const departures = rows.filter((r) => r.check_out === today).length;
  const inHouse = rows.filter((r) => r.status === 'in_house').length;

  const filtered = useMemo(() => rows.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (q && !`${r.guest_name} ${r.ref}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, status, q]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reservations" subtitle="Today's arrivals, departures and in-house guests, plus all upcoming reservations. Click a row for full detail." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="reservations" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Arrivals today" value={arrivals.toLocaleString('en-NG')} accent="#340075" />
        <Kpi label="Departures today" value={departures.toLocaleString('en-NG')} />
        <Kpi label="In-house" value={inHouse.toLocaleString('en-NG')} accent="#1d4ed8" />
        <Kpi label="Total reservations" value={rows.length.toLocaleString('en-NG')} />
      </div>

      <FilterBar>
        <div><label style={label()}>Status</label><select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>{['all', 'confirmed', 'in_house', 'completed', 'no_show', 'cancelled_by_guest', 'cancelled_by_hotel'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
        <div><label style={label()}>Search guest / ref</label><input style={input()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chioma or PMX-STY-7741" /></div>
      </FilterBar>

      <Card title={`Reservations (${filtered.length})`}>
        <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No reservations match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Ref</th><th style={th()}>Guest</th><th style={th()}>Room / rate</th><th style={th()}>Dates</th><th style={th()}>Nights</th><th style={th()}>Total</th><th style={th()}>Payment</th><th style={th()}>Channel</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><Link href={`/extranet/reservations/${r.id}`} style={{ color: '#340075', fontWeight: 600 }}><code style={{ fontSize: '0.78rem' }}>{r.ref}</code></Link></td>
                  <td style={td()}>{r.guest_name}</td>
                  <td style={td()}>{r.room_type_name}<div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{r.rate_plan_name}</div></td>
                  <td style={td()}>{fmtDate(r.check_in)} → {fmtDate(r.check_out)}</td>
                  <td style={td()}>{r.nights}</td>
                  <td style={td()}>{formatNaira(r.total_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{r.currency}</span></td>
                  <td style={td()}><Badge status={r.payment_status} /></td>
                  <td style={td()}><Badge status={r.channel} /></td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
