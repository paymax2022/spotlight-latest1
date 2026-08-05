'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listRiders, listDispatchQueue, assignRider, redispatchOrder } from '@/services/restaurantAdminService';
import type { Rider, DispatchOrder } from '@/types/restaurantAdmin';
import { naira, RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const RIDER_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On delivery',
  offline: 'Offline',
  suspended: 'Suspended',
};

const STATUS_COLOR: Record<string, string> = {
  placed: colors.info,
  accepted: colors.info,
  preparing: colors.warning,
  ready: colors.warning,
  assigned: colors.info,
  picked_up: colors.info,
  delivered: colors.success,
  cancelled: colors.secondary,
  refunded: colors.secondary,
  no_rider: colors.danger,
  available: colors.success,
  on_delivery: colors.info,
  offline: colors.secondary,
  suspended: colors.danger,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

function KpiTile({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

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
      <Page>
        <PageHeader title="Rider Dispatch" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.dispatch" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Rider Dispatch Board"
        subtitle="Assign and track riders against the live delivery queue. Board auto-refreshes every 15s."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Available riders" value={String(availableRiders.length)} accent={colors.success} />
        <KpiTile label="On delivery" value={String(onDelivery.length)} accent={colors.info} />
        <KpiTile label="Queue" value={String(queue.length)} sub="orders in dispatch flow" />
        <KpiTile label="No-rider" value={String(noRider.length)} accent={noRider.length ? colors.danger : colors.success} sub="needs manual action" />
      </div>

      <Card title="Dispatch queue">
        {loading && queue.length === 0 ? (
          <p style={{ color: colors.muted }}>Loading queue…</p>
        ) : queue.length === 0 ? (
          <p style={{ color: colors.muted }}>Nothing awaiting dispatch.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Order</th>
                  <th style={thCell}>Restaurant</th>
                  <th style={thCell}>Address</th>
                  <th style={thCell}>Rider</th>
                  <th style={thCell}>Fee</th>
                  <th style={thCell}>Waiting</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => (
                  <tr key={o.id}>
                    <td style={tdCell} title={o.id}>{o.id}</td>
                    <td style={tdCell}>{o.restaurant_name || o.restaurant_id}</td>
                    <td style={tdCell}>{o.delivery_address || '—'}</td>
                    <td style={tdCell}>{o.rider_name ? o.rider_name : <span style={{ color: colors.muted }}>unassigned</span>}</td>
                    <td style={tdCell}>{naira(o.delivery_fee_kobo)}</td>
                    <td style={tdCell}>{o.waiting_minutes ? <strong style={{ color: o.waiting_minutes > 15 ? colors.danger : colors.text }}>{o.waiting_minutes}m</strong> : '—'}</td>
                    <td style={tdCell}><StatusBadge status={o.status} /></td>
                    <td style={tdCell}>
                      {!o.rider_id ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {assignFor === o.id ? (
                            <select
                              autoFocus
                              disabled={busy === o.id}
                              onChange={(e) => e.target.value && void onAssign(o.id, e.target.value)}
                              defaultValue=""
                            >
                              <option value="" disabled>Pick rider…</option>
                              {availableRiders.map((r) => (
                                <option key={r.id} value={r.id}>{r.name} · {r.zone ?? '—'}</option>
                              ))}
                            </select>
                          ) : (
                            <Button
                              sm
                              variant="outline"
                              disabled={!canDispatch || busy === o.id}
                              title={!canDispatch ? 'Requires restaurant.admin.dispatch' : 'Manually offer to a rider'}
                              onClick={() => setAssignFor(o.id)}
                            >
                              Assign
                            </Button>
                          )}
                          {o.status === 'no_rider' && (
                            <Button
                              sm
                              variant="outline"
                              disabled={!canDispatch || busy === o.id}
                              title={!canDispatch ? 'Requires restaurant.admin.dispatch' : 'Re-run auto-dispatch'}
                              onClick={() => void onRedispatch(o.id)}
                            >
                              {busy === o.id ? '…' : 'Re-dispatch'}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>
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
          <p style={{ color: colors.muted }}>Loading riders…</p>
        ) : riders.length === 0 ? (
          <p style={{ color: colors.muted }}>No riders.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Rider</th>
                  <th style={thCell}>Vehicle</th>
                  <th style={thCell}>Zone</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Active order</th>
                  <th style={thCell}>Today</th>
                  <th style={thCell}>Rating</th>
                  <th style={thCell}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.name}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{r.phone}</div></td>
                    <td style={tdCell}>{r.vehicle ?? '—'}</td>
                    <td style={tdCell}>{r.zone ?? '—'}</td>
                    <td style={tdCell}><StatusBadge status={r.status} label={RIDER_STATUS_LABEL[r.status]} /></td>
                    <td style={tdCell}>{r.active_order_id ?? <span style={{ color: colors.muted }}>—</span>}</td>
                    <td style={tdCell}>{r.deliveries_today ?? 0}</td>
                    <td style={tdCell}>{r.rating?.toFixed(1) ?? '—'}</td>
                    <td style={tdCell}>{r.last_seen_at ? new Date(r.last_seen_at).toLocaleTimeString('en-NG') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Assign consumes the live <code>POST /api/finance/restaurant/orders/:orderId/assign</code>;
        Re-dispatch consumes <code>POST /api/finance/restaurant/orders/:orderId/dispatch</code>. The
        rider roster + dispatch feed are mock-first (no admin-wide feed yet) — flip{' '}
        <code>NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false</code> once the admin routes land.
      </p>
    </Page>
  );
}
