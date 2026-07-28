'use client';

import { useEffect, useState } from 'react';
import { listReservations, listRoomTypes, modifyReservation, markNoShow } from '@/services/staysExtranetService';
import type { ReservationSummary, RoomType, ModifyReservationPayload } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, btnDanger, input, label, select } from '../_ui';

export default function ModifyPage() {
  const [reservations, setReservations] = useState<ReservationSummary[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resId, setResId] = useState('');
  const [action, setAction] = useState<ModifyReservationPayload['action']>('modify_dates');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { const [r, rt] = await Promise.all([listReservations(), listRoomTypes()]); setReservations(r); setRooms(rt); if (r[0]) setResId(r[0].id); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function apply() {
    setBusy(true); setResult(null);
    try {
      const res = action === 'mark_no_show'
        ? await markNoShow(resId, reason)
        : await modifyReservation({ reservation_id: resId, action, new_check_in: checkIn || undefined, new_check_out: checkOut || undefined, new_room_type_id: roomId || undefined, reason });
      setResult(`${res.message} New status: ${res.status.replace(/_/g, ' ')}.`);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Modify / cancel / no-show" subtitle="Change dates or room, cancel a reservation, or mark a guest as a no-show. Cancellation and refund rules follow the rate plan policy." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="reservations" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={reservations.length === 0} emptyText="No reservations to modify.">
        <Card title="Select reservation">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.7rem' }}>
            <div><label style={label()}>Reservation</label>
              <select style={select()} value={resId} onChange={(e) => setResId(e.target.value)}>
                {reservations.map((r) => <option key={r.id} value={r.id}>{r.ref} — {r.guest_name}</option>)}
              </select>
            </div>
            <div><label style={label()}>Action</label>
              <select style={select()} value={action} onChange={(e) => setAction(e.target.value as ModifyReservationPayload['action'])}>
                <option value="modify_dates">Modify dates</option>
                <option value="modify_room">Modify room type</option>
                <option value="cancel">Cancel reservation</option>
                <option value="mark_no_show">Mark no-show</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.7rem' }}>
            {action === 'modify_dates' && (
              <>
                <div><label style={label()}>New check-in</label><input style={input()} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
                <div><label style={label()}>New check-out</label><input style={input()} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
              </>
            )}
            {action === 'modify_room' && (
              <div><label style={label()}>New room type</label><select style={select()} value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">Select…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            )}
            <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Reason / note</label><input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason for the guest record" /></div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button style={action === 'cancel' || action === 'mark_no_show' ? btnDanger() : btnPrimary()} onClick={apply} disabled={busy || !resId}>{busy ? 'Applying…' : 'Apply action'}</button>
            {result ? <span style={{ color: '#15803d', fontSize: '0.85rem' }}>{result}</span> : null}
          </div>
          {action === 'mark_no_show' && <p style={{ fontSize: '0.78rem', color: '#9a3412', marginTop: '0.5rem' }}>No-show may forfeit the deposit per your cancellation policy.</p>}
        </Card>
      </StateBlock>
    </div>
  );
}
