'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  getScheduledBooking, forceDispatchScheduled, reassignScheduled, cancelScheduled,
} from '@/services/scheduledAdminService';
import type { ScheduledBookingDetail } from '@/types/scheduledMobility';
import {
  Card, Badge, StateNote, AuditedNotice,
  btn, btnPrimary, btnDisabled, input, card, naira,
  useMobilityPermissions,
} from '../../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';
import { SCHEDULED_PERMS } from '../_perms';

type ActionKind = 'force-dispatch' | 'reassign' | 'cancel' | null;

function materializedHref(kind: ScheduledBookingDetail['materializedKind'], ref: string | null): string | null {
  if (!ref) return null;
  if (kind === 'trip') return `/admin/mobility/dispatch?trip=${ref}`;
  if (kind === 'parcel') return `/admin/mobility/parcels?parcel=${ref}`;
  if (kind === 'bus_ticket') return `/admin/mobility/bus?ticket=${ref}`;
  return null;
}

export default function ScheduledBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMobilityPermissions();
  const canView = can(SCHEDULED_PERMS.read);
  const canReassign = can(SCHEDULED_PERMS.reassign);
  const canCancel = can(SCHEDULED_PERMS.cancel);

  const [booking, setBooking] = useState<ScheduledBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [action, setAction] = useState<ActionKind>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBooking(await getScheduledBooking(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const openAction = (a: ActionKind) => { setAction(a); setReasonCode(''); setDriverId(''); setError(null); };

  const submit = async () => {
    if (!action) return;
    // Block submit if empty — the primary guard. The service layer also
    // throws (defense-in-depth) if this is somehow bypassed.
    if (!reasonCode.trim()) { setError('reason_code is required and cannot be empty.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      let updated: ScheduledBookingDetail;
      if (action === 'force-dispatch') {
        updated = await forceDispatchScheduled(id, { reasonCode: reasonCode.trim() });
        setMessage(`Force-dispatch submitted for ${id} (reason_code: ${reasonCode.trim()}) — audit entry recorded.`);
      } else if (action === 'reassign') {
        updated = await reassignScheduled(id, { reasonCode: reasonCode.trim(), driverId: driverId.trim() || undefined });
        setMessage(`Reassign submitted for ${id} (reason_code: ${reasonCode.trim()}) — audit entry recorded.`);
      } else {
        updated = await cancelScheduled(id, { reasonCode: reasonCode.trim() });
        setMessage(`Booking ${id} cancelled (reason_code: ${reasonCode.trim()}) — audit entry recorded.`);
      }
      setBooking(updated);
      setAction(null); setReasonCode(''); setDriverId('');
    } catch (e) {
      setError(`Action failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!canView) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <p><Link href="/admin/mobility/scheduled">← Back to scheduled bookings</Link></p>
        <StateNote kind="restricted">You do not have transport.admin.scheduled.read — this view is unavailable for your role.</StateNote>
      </div>
    );
  }

  if (loading) return <div style={{ padding: '0.5rem' }}><StateNote kind="loading">Loading scheduled booking…</StateNote></div>;
  if (error && !booking) return <div style={{ padding: '0.5rem' }}><p><Link href="/admin/mobility/scheduled">← Back to scheduled bookings</Link></p><StateNote kind="error">{error}</StateNote></div>;
  if (!booking) return <div style={{ padding: '0.5rem' }}><StateNote kind="empty">Scheduled booking not found.</StateNote></div>;

  const canForceDispatch = booking.status === 'failed_no_driver' || booking.status === 'dispatch_pending' || booking.status === 'scheduled';
  const canCancelBooking = booking.status === 'scheduled' || booking.status === 'dispatch_pending' || booking.status === 'failed_no_driver';
  const matHref = materializedHref(booking.materializedKind, booking.materializedRef);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <p><Link href="/admin/mobility/scheduled">← Back to scheduled bookings</Link></p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{booking.id}</h1>
        <Badge status={booking.status} />
        <span style={{ fontSize: '0.8rem', color: colors.muted }}>{booking.mode.replace(/_/g, ' ')}</span>
      </div>
      <p style={{ fontSize: '0.85rem', color: colors.muted, margin: '0 0 1rem' }}>
        {booking.userName} ({booking.userId}) · market {booking.marketId} · pickup {new Date(booking.scheduledPickupAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} ({booking.timezone}) · lead time {booking.leadTimeMinutes}m
      </p>

      <AuditedNotice text="Force-dispatch, reassign and cancel require transport.admin.scheduled.reassign / .cancel and a reason_code." />
      {message && <StateNote kind="loading">{message}</StateNote>}
      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem' }}>
        <div>
          <Card title="Booking">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted, width: '35%' }}>Pickup</td><td style={tdCell}>{booking.pickupLabel ?? '—'}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Dropoff</td><td style={tdCell}>{booking.dropoffLabel ?? '—'}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Estimated fare</td><td style={tdCell}>{booking.estimatedFareKobo != null ? naira(booking.estimatedFareKobo) : '—'} {booking.currency}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Payment method</td><td style={tdCell}>{booking.paymentMethod}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Settlement ref</td><td style={tdCell}>{booking.settlementId ?? '—'}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Dispatch attempts</td><td style={tdCell}>{booking.dispatchAttempts}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Last dispatch error</td><td style={tdCell}>{booking.lastDispatchError ? <span style={{ color: colors.danger }}>{booking.lastDispatchError}</span> : '—'}</td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Materialized</td><td style={tdCell}>
                  {booking.materializedRef
                    ? (matHref ? <Link href={matHref}>{booking.materializedKind}: {booking.materializedRef} →</Link> : `${booking.materializedKind}: ${booking.materializedRef}`)
                    : '—'}
                </td></tr>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ ...tdCell, color: colors.muted }}>Reminders</td><td style={tdCell}>
                  24h {booking.reminder24hSentAt ? `sent ${new Date(booking.reminder24hSentAt).toLocaleString('en-NG')}` : 'pending'} · 1h {booking.reminder1hSentAt ? `sent ${new Date(booking.reminder1hSentAt).toLocaleString('en-NG')}` : 'pending'}
                </td></tr>
                {booking.cancelReason && (
                  <tr><td style={{ ...tdCell, color: colors.muted }}>Cancel reason</td><td style={tdCell}>{booking.cancelReason}</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card title="Mode payload">
            <pre style={{ margin: 0, fontSize: '0.78rem', background: colors.headBg, padding: '0.75rem', borderRadius: '0.375rem', overflowX: 'auto' }}>
              {JSON.stringify(booking.modePayload, null, 2)}
            </pre>
          </Card>

          <Card title={`Dispatch history (${booking.dispatchHistory.length})`}>
            {booking.dispatchHistory.length === 0 ? <StateNote kind="empty">No dispatch attempts yet.</StateNote> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Attempt</th><th style={thCell}>Outcome</th><th style={thCell}>Error</th><th style={thCell}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {booking.dispatchHistory.map((d) => (
                    <tr key={d.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}>{d.attempt}</td>
                      <td style={tdCell}><Badge status={d.outcome === 'success' ? 'completed' : d.outcome === 'failed' ? 'failed' : 'pending'} label={d.outcome} /></td>
                      <td style={tdCell}>{d.error ?? '—'}</td>
                      <td style={tdCell}>{new Date(d.createdAt).toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={`Admin audit (${booking.auditLog.length})`}>
            {booking.auditLog.length === 0 ? <StateNote kind="empty">No admin actions recorded yet.</StateNote> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Action</th><th style={thCell}>reason_code</th><th style={thCell}>Actor</th><th style={thCell}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {booking.auditLog.map((a) => (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}>{a.action}</td>
                      <td style={tdCell}><code>{a.reasonCode}</code></td>
                      <td style={tdCell}>{a.actor}</td>
                      <td style={tdCell}>{new Date(a.createdAt).toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div>
          <div style={{ ...card() }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Admin actions</h2>
            {!canReassign && !canCancel && (
              <StateNote kind="restricted">Read-only — your role cannot force-dispatch, reassign or cancel.</StateNote>
            )}
            {!action ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  disabled={!canReassign || !canForceDispatch}
                  style={canReassign && canForceDispatch ? btnPrimary() : btnDisabled()}
                  onClick={() => openAction('force-dispatch')}
                  title={!canForceDispatch ? `Not applicable in status ${booking.status}` : undefined}
                >
                  Force-Dispatch
                </button>
                <button
                  disabled={!canReassign}
                  style={canReassign ? btnPrimary(colors.primary) : btnDisabled()}
                  onClick={() => openAction('reassign')}
                >
                  Reassign
                </button>
                <button
                  disabled={!canCancel || !canCancelBooking}
                  style={canCancel && canCancelBooking ? btnPrimary(colors.danger) : btnDisabled()}
                  onClick={() => openAction('cancel')}
                  title={!canCancelBooking ? `Not applicable in status ${booking.status}` : undefined}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize' }}>
                  {action.replace('-', ' ')} — reason_code (required)
                </label>
                <input
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  style={input()}
                  placeholder="e.g. OPS_MANUAL_RETRY, DRIVER_UNRESPONSIVE, USER_SUPPORT_REQUEST"
                />
                {action === 'reassign' && (
                  <>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Driver ID (optional — hand to a specific driver)</label>
                    <input value={driverId} onChange={(e) => setDriverId(e.target.value)} style={input()} placeholder="drv_1003" />
                  </>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button style={btn()} disabled={busy} onClick={() => setAction(null)}>Cancel</button>
                  <button
                    style={busy || !reasonCode.trim() ? btnDisabled() : btnPrimary()}
                    disabled={busy || !reasonCode.trim()}
                    onClick={submit}
                  >
                    {busy ? 'Submitting…' : 'Confirm (audited)'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
