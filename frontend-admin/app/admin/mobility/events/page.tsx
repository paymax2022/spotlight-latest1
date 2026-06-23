'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getEventOffers, setEventOfferStatus, getEventBookings,
} from '@/services/mobilityEventsAdminService';
import type {
  EventOfferRow, EventOfferStatus, EventBookingRow,
} from '@/types/mobilityModes';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, btnPrimary, btnDisabled, th, td, input, nairaFull,
  useMobilityPermissions, MOBILITY_PERMS,
} from '../_ui';

const OFFER_FILTER: Array<EventOfferStatus | ''> = ['', 'draft', 'open', 'full', 'departed', 'completed', 'cancelled'];
const OFFER_OPTIONS: EventOfferStatus[] = ['draft', 'open', 'full', 'departed', 'completed', 'cancelled'];
// Sensitive offer transitions that always require an audited reason.
const OFFER_SENSITIVE: EventOfferStatus[] = ['cancelled'];

export default function MobilityEventsPage() {
  const { can } = useMobilityPermissions();
  const canManage = can(MOBILITY_PERMS.eventsManage);

  const [offers, setOffers] = useState<EventOfferRow[]>([]);
  const [bookings, setBookings] = useState<EventBookingRow[]>([]);
  const [offerFilter, setOfferFilter] = useState<EventOfferStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // offer status modal
  const [offer, setOffer] = useState<EventOfferRow | null>(null);
  const [form, setForm] = useState<{ status: EventOfferStatus; reason: string }>({ status: 'draft', reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, b] = await Promise.all([getEventOffers(offerFilter), getEventBookings()]);
      setOffers(o); setBookings(b);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [offerFilter]);

  useEffect(() => { void load(); }, [load]);

  const openOffer = (o: EventOfferRow) => { setOffer(o); setForm({ status: o.status, reason: '' }); };

  const submitOffer = async () => {
    if (!offer) return;
    if (OFFER_SENSITIVE.includes(form.status) && !form.reason.trim()) { setError('A reason is required to cancel an offer.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      await setEventOfferStatus(offer.id, { status: form.status, reason: form.reason.trim() || undefined });
      setMessage(`Offer ${offer.id} → ${form.status} (audited).`);
      setOffer(null); await load();
    } catch (e) { setError(`Update failed: ${String(e)}`); }
    finally { setBusy(false); }
  };

  const openOffers = offers.filter((o) => o.status === 'open').length;
  const seatsBooked = offers.reduce((sum, o) => sum + o.bookedCount, 0);
  const activeBookings = bookings.filter((b) => !['cancelled', 'refunded', 'completed'].includes(b.status)).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Event Transport"
        subtitle="Organizer transport offers (fan bus, group ride, shuttle) and rider bookings."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="events" />
      <AuditedNotice text="Offer status changes require the mobility.events.manage role." />

      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open offers" value={String(openOffers)} accent="#16a34a" />
        <Kpi label="Seats booked" value={String(seatsBooked)} accent="#1d4ed8" />
        <Kpi label="Active bookings" value={String(activeBookings)} />
      </div>

      {/* ── Offers ── */}
      <Card
        title="Transport offers"
        right={
          <select value={offerFilter} onChange={(e) => setOfferFilter(e.target.value as EventOfferStatus | '')} style={{ ...input(), width: 'auto' }}>
            {OFFER_FILTER.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        }
      >
        {!canManage && <StateNote kind="restricted">You have read-only access — offer status actions are disabled for your role.</StateNote>}
        {loading ? <StateNote kind="loading">Loading offers…</StateNote>
          : offers.length === 0 ? <StateNote kind="empty">No offers match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Offer</th><th style={th()}>Venue</th><th style={th()}>Capacity</th><th style={th()}>Fare</th><th style={th()}>Departure</th><th style={th()}>Status</th><th style={th()}></th>
              </tr></thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{o.title}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{o.organizerName} · {o.type.replace(/_/g, ' ')}{o.busScheduleId ? ` · bus ${o.busScheduleId}` : ''}</div></td>
                    <td style={td()}>{o.venue}</td>
                    <td style={td()}>{o.bookedCount}/{o.capacity}</td>
                    <td style={td()}>{nairaFull(o.fareKobo)}</td>
                    <td style={td()}>{new Date(o.departureTime).toLocaleString()}</td>
                    <td style={td()}><Badge status={o.status} /></td>
                    <td style={td()}><button style={btn()} onClick={() => openOffer(o)}>{canManage ? 'Manage' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* ── Bookings (read-only) ── */}
      <Card title="Bookings">
        {loading ? <StateNote kind="loading">Loading bookings…</StateNote>
          : bookings.length === 0 ? <StateNote kind="empty">No bookings.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Booking</th><th style={th()}>Rider</th><th style={th()}>Offer</th><th style={th()}>Seats</th><th style={th()}>Total</th><th style={th()}>Status</th><th style={th()}>Escrow</th>
              </tr></thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td()}><strong>{b.id}</strong>{b.ticketRef ? <div style={{ fontSize: '0.72rem', color: '#1d4ed8' }}>🎟 {b.ticketRef} (bundle)</div> : <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>ride only</div>}</td>
                    <td style={td()}>{b.riderName}</td>
                    <td style={td()}>{b.offerTitle}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{b.type.replace(/_/g, ' ')}</div></td>
                    <td style={td()}>{b.seats}</td>
                    <td style={td()}>{nairaFull(b.totalKobo)}</td>
                    <td style={td()}><Badge status={b.status} /></td>
                    <td style={td()}><Badge status={b.escrowStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {/* Offer status modal */}
      {offer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !busy && setOffer(null)}>
          <div style={{ background: '#fff', borderRadius: '0.5rem', padding: '1.25rem', width: 'min(520px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{offer.title}</h2>
              <Badge status={offer.status} />
            </div>
            <p style={{ fontSize: '0.82rem', color: '#374151', margin: '0 0 0.25rem' }}>{offer.organizerName} · {offer.type.replace(/_/g, ' ')} · {offer.venue}</p>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 1rem' }}>Capacity {offer.bookedCount}/{offer.capacity} · Fare {nairaFull(offer.fareKobo)} · Departs {new Date(offer.departureTime).toLocaleString()}</p>
            {!canManage ? (
              <StateNote kind="restricted">Read-only — your role cannot update offers.</StateNote>
            ) : (
              <>
                <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Update status
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EventOfferStatus }))} style={{ ...input(), marginTop: 4 }}>
                    {OFFER_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: '0.75rem' }}>
                  Reason {OFFER_SENSITIVE.includes(form.status) ? '(required)' : '(optional)'}
                  <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2} style={{ ...input(), marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setOffer(null)}>Close</button>
              {canManage && <button style={busy ? btnDisabled() : btnPrimary()} disabled={busy} onClick={submitOffer}>{busy ? 'Saving…' : 'Save status (audited)'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
