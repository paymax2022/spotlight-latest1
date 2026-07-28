'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listRiders, listDispatchQueue, assignRider, redispatchOrder } from '@/services/restaurantAdminService';
import type { Rider, DispatchOrder } from '@/types/restaurantAdmin';
import {
  PageHeader,
  Card,
  Kpi,
  Badge,
  btn,
  th,
  td,
  naira,
  RESTAURANT_PERMS,
  useRestaurantPermissions,
  AccessNotice,
} from '../_ui';

const RIDER_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On delivery',
  offline: 'Offline',
  suspended: 'Suspended',
};

const RIDER_BADGE: Record<string, string> = {
  available: 'delivered',
  on_delivery: 'assigned',
  offline: 'cancelled',
  suspended: 'no_rider',
};

export default function RiderDispatchPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.dispatch);
  const canDispatch = can(RESTAURANT_PERMS.dispatch);

  const [riders, setRiders] = useState<Rider[]>([]);
  const [queue, setQueue] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rs, q] = await Promise.all([listRiders(), listDispatchQueue()]);
      setRiders(rs);
      setQueue(q);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll for a "live-ish" board every 15s.
  useEffect(() => {
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const availableRiders = useMemo(() => riders.filter((r) => r.status === 'available'), [riders]);
  const onDelivery = useMemo(() => riders.filter((r) => r.status === 'on_delivery'), [riders]);
  const noRider = useMemo(() => queue.filter((o) => o.status === 'no_rider'), [queue]);

  async function onAssign(orderId: string, riderId: string) {
    setBusy(orderId);
    setError(null);
    setMessage(null);
    try {
      await assignRider(orderId, riderId);
      setMessage(`Offered order ${orderId} to rider ${riderId}.`);
      setAssignFor(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRedispatch(orderId: string) {
    setBusy(orderId);
    setError(null);
    setMessage(null);
    try {
      await redispatchOrder(orderId);
      setMessage(`Re-ran auto-dispatch for order ${orderId}.`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!canView) {
    return (
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Rider Dispatch" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.dispatch" />
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Rider Dispatch Board"
        subtitle="Assign and track riders against the live delivery queue. Board auto-refreshes every 15s."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p style={{ color: '#16a34a' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Available riders" value={String(availableRiders.length)} accent="#16a34a" />
        <Kpi label="On delivery" value={String(onDelivery.length)} accent="#155e75" />
        <Kpi label="Queue" value={String(queue.length)} sub="orders in dispatch flow" />
        <Kpi label="No-rider" value={String(noRider.length)} accent={noRider.length ? '#dc2626' : '#16a34a'} sub="needs manual action" />
      </div>

      <Card title="Dispatch queue">
        {loading && queue.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Loading queue…</p>
        ) : queue.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Nothing awaiting dispatch.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Order</th>
                  <th style={th()}>Restaurant</th>
                  <th style={th()}>Address</th>
                  <th style={th()}>Rider</th>
                  <th style={th()}>Fee</th>
                  <th style={th()}>Waiting</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => (
                  <tr key={o.id}>
                    <td style={td()} title={o.id}>{o.id}</td>
                    <td style={td()}>{o.restaurant_name || o.restaurant_id}</td>
                    <td style={td()}>{o.delivery_address || '—'}</td>
                    <td style={td()}>{o.rider_name ? o.rider_name : <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}>{naira(o.delivery_fee_kobo)}</td>
                    <td style={td()}>{o.waiting_minutes ? <strong style={{ color: o.waiting_minutes > 15 ? '#dc2626' : '#374151' }}>{o.waiting_minutes}m</strong> : '—'}</td>
                    <td style={td()}><Badge status={o.status} /></td>
                    <td style={td()}>
                      {!o.rider_id ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {assignFor === o.id ? (
                            <select
                              autoFocus
                              disabled={busy === o.id}
                              onChange={(e) => e.target.value && void onAssign(o.id, e.target.value)}
                              style={{ ...btn(), padding: '0.3rem' }}
                              defaultValue=""
                            >
                              <option value="" disabled>Pick rider…</option>
                              {availableRiders.map((r) => (
                                <option key={r.id} value={r.id}>{r.name} · {r.zone ?? '—'}</option>
                              ))}
                            </select>
                          ) : (
                            <button
                              disabled={!canDispatch || busy === o.id}
                              title={!canDispatch ? 'Requires restaurant.admin.dispatch' : 'Manually offer to a rider'}
                              onClick={() => setAssignFor(o.id)}
                              style={btn()}
                            >
                              Assign
                            </button>
                          )}
                          {o.status === 'no_rider' && (
                            <button
                              disabled={!canDispatch || busy === o.id}
                              title={!canDispatch ? 'Requires restaurant.admin.dispatch' : 'Re-run auto-dispatch'}
                              onClick={() => void onRedispatch(o.id)}
                              style={btn()}
                            >
                              {busy === o.id ? '…' : 'Re-dispatch'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: '1.25rem' }} />

      <Card title="Riders">
        {loading && riders.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Loading riders…</p>
        ) : riders.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No riders.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Rider</th>
                  <th style={th()}>Vehicle</th>
                  <th style={th()}>Zone</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Active order</th>
                  <th style={th()}>Today</th>
                  <th style={th()}>Rating</th>
                  <th style={th()}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><strong>{r.name}</strong><div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{r.phone}</div></td>
                    <td style={td()}>{r.vehicle ?? '—'}</td>
                    <td style={td()}>{r.zone ?? '—'}</td>
                    <td style={td()}><Badge status={RIDER_BADGE[r.status]} label={RIDER_STATUS_LABEL[r.status]} /></td>
                    <td style={td()}>{r.active_order_id ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>{r.deliveries_today ?? 0}</td>
                    <td style={td()}>{r.rating?.toFixed(1) ?? '—'}</td>
                    <td style={td()}>{r.last_seen_at ? new Date(r.last_seen_at).toLocaleTimeString('en-NG') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        Assign consumes the live <code>POST /api/finance/restaurant/orders/:orderId/assign</code>;
        Re-dispatch consumes <code>POST /api/finance/restaurant/orders/:orderId/dispatch</code>. The
        rider roster + dispatch feed are mock-first (no admin-wide feed yet) — flip{' '}
        <code>NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false</code> once the admin routes land.
      </p>
    </div>
  );
}
