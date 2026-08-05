'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getScheduledBookings, SCHEDULED_STATUSES, SCHEDULED_MODES } from '@/services/scheduledAdminService';
import type { ScheduledBookingRow, ScheduledStatus, ScheduledMode } from '@/types/scheduledMobility';
import {
  PageHeader, MobilityTabs, Card, Badge, StateNote, AuditedNotice, Kpi,
  btn, input, naira,
  useMobilityPermissions,
} from '../_ui';
import { colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { SCHEDULED_PERMS } from './_perms';

function countdownLabel(pickupAtIso: string): { text: string; overdue: boolean } {
  const diffMs = new Date(pickupAtIso).getTime() - Date.now();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return { text: overdue ? `${mins}m overdue` : `in ${mins}m`, overdue };
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  const text = `${hrs}h ${remMins}m`;
  return { text: overdue ? `${text} overdue` : `in ${text}`, overdue };
}

export default function ScheduledOpsBoardPage() {
  const { can } = useMobilityPermissions();
  const canView = can(SCHEDULED_PERMS.read);

  const [status, setStatus] = useState<ScheduledStatus | ''>('');
  const [mode, setMode] = useState<ScheduledMode | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [rows, setRows] = useState<ScheduledBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try { setRows(await getScheduledBookings({ status, mode, from: from || undefined, to: to || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView, status, mode, from, to]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000); // keep aging/countdowns fresh
    return () => clearInterval(t);
  }, [load]);

  const failedAging = useMemo(() => rows.filter((r) => r.status === 'failed_no_driver'), [rows]);

  if (!canView) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Scheduled Bookings" subtitle="Ops board for scheduled ride, parcel, airport-pickup and bus bookings." />
        <MobilityTabs active="scheduled" />
        <StateNote kind="restricted">You do not have transport.admin.scheduled.read — this view is unavailable for your role.</StateNote>
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Scheduled Bookings"
        subtitle="Ops board for scheduled ride, parcel, airport-pickup and bus bookings. failed_no_driver is surfaced first, oldest aging first."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <MobilityTabs active="scheduled" />
      <AuditedNotice text="Force-dispatch, reassign and cancel require transport.admin.scheduled.reassign / .cancel." />

      {error && <StateNote kind="error">{error}</StateNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total (filtered)" value={String(rows.length)} />
        <Kpi label="Failed — no driver" value={String(failedAging.length)} accent={failedAging.length ? colors.danger : colors.success} />
        <Kpi label="Dispatch pending" value={String(rows.filter((r) => r.status === 'dispatch_pending').length)} accent={colors.info} />
        <Kpi label="Scheduled (upcoming)" value={String(rows.filter((r) => r.status === 'scheduled').length)} />
      </div>

      <Card
        title="Filters"
        right={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select value={status} onChange={(e) => setStatus(e.target.value as ScheduledStatus | '')} style={{ ...input(), width: 'auto' }}>
              <option value="">All statuses</option>
              {SCHEDULED_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value as ScheduledMode | '')} style={{ ...input(), width: 'auto' }}>
              <option value="">All modes</option>
              {SCHEDULED_MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...input(), width: 'auto' }} title="Pickup from" />
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...input(), width: 'auto' }} title="Pickup to" />
          </div>
        }
      >
        {loading && rows.length === 0 ? <StateNote kind="loading">Loading scheduled bookings…</StateNote>
          : rows.length === 0 ? <StateNote kind="empty">No scheduled bookings match this filter.</StateNote>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>User</th><th style={thCell}>Mode</th><th style={thCell}>Pickup</th>
                  <th style={thCell}>Status</th><th style={thCell}>Fare</th><th style={thCell}>Attempts</th>
                  <th style={thCell}>Last error</th><th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cd = countdownLabel(r.scheduledPickupAt);
                  const isFailed = r.status === 'failed_no_driver';
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}`, background: isFailed ? tint(colors.danger, 0.08) : undefined }}>
                      <td style={tdCell}><strong>{r.userName}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.userId}</div></td>
                      <td style={tdCell}>{r.mode.replace(/_/g, ' ')}</td>
                      <td style={tdCell}>
                        {new Date(r.scheduledPickupAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                        <div style={{ fontSize: '0.72rem', color: cd.overdue ? colors.danger : colors.muted, fontWeight: cd.overdue ? 700 : 400 }}>{cd.text}</div>
                      </td>
                      <td style={tdCell}><Badge status={r.status} /></td>
                      <td style={tdCell}>{r.estimatedFareKobo != null ? naira(r.estimatedFareKobo) : '—'}</td>
                      <td style={tdCell}>{r.dispatchAttempts}</td>
                      <td style={tdCell}>{r.lastDispatchError ? <span style={{ color: colors.danger, fontSize: '0.78rem' }}>{r.lastDispatchError}</span> : '—'}</td>
                      <td style={tdCell}><Link href={`/admin/mobility/scheduled/${r.id}`} style={btn()}>View</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}
