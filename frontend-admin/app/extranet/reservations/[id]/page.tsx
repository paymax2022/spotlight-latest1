'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getReservation, markNoShow, modifyReservation, formatNaira } from '@/services/staysExtranetService';
import type { ReservationDetail } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, btn, btnDanger, btnPrimary, th, td, fmtDate, timeAgo } from '../../_ui';

export default function ReservationDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<ReservationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReservation(id)); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function doNoShow() {
    if (!data) return;
    const r = await markNoShow(data.id, 'Guest did not arrive');
    setMsg(r.message); setData({ ...data, status: r.status });
  }
  async function doCancel() {
    if (!data) return;
    const r = await modifyReservation({ reservation_id: data.id, action: 'cancel', reason: 'Hotelier cancellation' });
    setMsg(r.message); setData({ ...data, status: r.status });
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reservation detail" subtitle="Guest, room, rate and payment status for a single reservation." action={<Link href="/extranet/reservations" style={{ ...btn(), textDecoration: 'none' }}>← Back to reservations</Link>} />
      <ExtranetTabs active="reservations" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Reservation not found.">
        {data && (
          <>
            <Card title={`${data.ref} — ${data.guest_name}`} right={<Badge status={data.status} />}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                <Kpi label="Total" value={formatNaira(data.total_kobo)} sub={data.currency} accent="#340075" />
                <Kpi label="Commission" value={formatNaira(data.commission_kobo)} />
                <Kpi label="Net to hotel" value={formatNaira(data.net_to_hotel_kobo)} accent="#15803d" />
                <Kpi label="Deposit held" value={formatNaira(data.deposit_kobo)} />
                <Kpi label="Balance due" value={formatNaira(data.balance_due_kobo)} accent={data.balance_due_kobo > 0 ? '#9a3412' : undefined} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={td()}>Guest</td><td style={td()}>{data.guest_name} · {data.guest_country}{data.loyalty_member ? <Badge status="enrolled" label="Loyalty member" /> : null}</td></tr>
                  <tr><td style={td()}>Contact</td><td style={td()}>{data.guest_email} · {data.guest_phone}</td></tr>
                  <tr><td style={td()}>Room / rate</td><td style={td()}>{data.room_type_name} — {data.rate_plan_name} (<Badge status={data.board} />)</td></tr>
                  <tr><td style={td()}>Stay</td><td style={td()}>{fmtDate(data.check_in)} → {fmtDate(data.check_out)} · {data.nights} night(s) · {data.guests} guest(s)</td></tr>
                  <tr><td style={td()}>Payment</td><td style={td()}><Badge status={data.payment_status} /> · via <Badge status={data.channel} /></td></tr>
                  <tr><td style={td()}>Special requests</td><td style={td()}>{data.special_requests ?? '—'}</td></tr>
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <Link href="/extranet/modify" style={{ ...btnPrimary(), textDecoration: 'none' }}>Modify dates / room</Link>
                <button style={btnDanger()} onClick={doNoShow} disabled={data.status === 'no_show'}>Mark no-show</button>
                <button style={btnDanger()} onClick={doCancel} disabled={data.status.startsWith('cancelled')}>Cancel reservation</button>
              </div>
              {msg ? <p style={{ color: '#15803d', fontSize: '0.85rem', marginTop: '0.5rem' }}>{msg}</p> : null}
            </Card>

            <Card title="Timeline">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Event</th><th style={th()}>Status</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.timeline.map((t, i) => (
                    <tr key={i}><td style={td()}>{t.label}</td><td style={td()}><Badge status={t.kind} /></td><td style={td()}>{timeAgo(t.at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
