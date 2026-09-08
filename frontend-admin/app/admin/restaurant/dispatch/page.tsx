'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listRiders, listDispatchQueue, assignRider, redispatchOrder } from '@/services/restaurantAdminService';
import type { DispatchOrder, OrderDispatchStatus, Rider, RiderStatus } from '@/types/restaurantAdmin';
import { naira, RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const RIDER_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On delivery',
  offline: 'Offline',
  suspended: 'Suspended',
};

// Order statuses (the `orders_status_check` vocabulary — `placed`, `accepted`,
// `assigned`, `refunded` and `no_rider` were never among them) plus rider states,
// which share this badge.
const STATUS_COLOR: Record<string, string> = {
  pending: colors.info,
  confirmed: colors.info,
  preparing: colors.warning,
  ready: colors.warning,
  picked_up: colors.info,
  delivered: colors.success,
  cancelled: colors.secondary,
  rejected: colors.danger,
  dispatch_failed: colors.danger,
  delivery_failed: colors.danger,
  available: colors.success,
  on_delivery: colors.info,
  offline: colors.secondary,
  suspended: colors.danger,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

/** Prev/next pager shared by both boards — same shape as the restaurant register. */
function Pager({ page, total, count, loading, onPage }: {
  page: number; total: number; count: number; loading: boolean; onPage: (n: number) => void;
}) {
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE + count);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: '0.9rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.8rem', color: colors.muted }}>
        {`Showing ${first.toLocaleString('en-NG')}–${last.toLocaleString('en-NG')} of ${total.toLocaleString('en-NG')}`}
        {loading ? ' · refreshing…' : ''}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button sm variant="outline" disabled={page === 0 || loading} onClick={() => onPage(Math.max(0, page - 1))}>Previous</Button>
        <span style={{ fontSize: '0.8rem', color: colors.muted }}>
          Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </span>
        <Button sm variant="outline" disabled={last >= total || loading} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
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

const PAGE_SIZE = 25;

/**
 * Only a placeholder until the first response lands — the SERVER owns this
 * threshold and sends it as `stalled_after_minutes`, so the board never renders
 * a number the backend disagrees with.
 */
const DEFAULT_STALLED_MINUTES = 10;

const RIDER_STATUS_TABS: readonly (RiderStatus | '')[] = ['', 'available', 'on_delivery', 'offline', 'suspended'];
const DISPATCH_TABS: readonly (OrderDispatchStatus | '')[] = ['', 'searching', 'assigned', 'none'];

const EMPTY_RIDER_COUNTS: Record<RiderStatus, number> = {
  available: 0, on_delivery: 0, offline: 0, suspended: 0,
};

export default function RiderDispatchPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.dispatch);
  const canDispatch = can(RESTAURANT_PERMS.dispatch);

  const [riders, setRiders] = useState<Rider[]>([]);
  const [riderCounts, setRiderCounts] = useState<Record<RiderStatus, number>>(EMPTY_RIDER_COUNTS);
  const [riderTotal, setRiderTotal] = useState(0);
  const [riderPage, setRiderPage] = useState(0);
  const [riderStatus, setRiderStatus] = useState<RiderStatus | ''>('');

  const [queue, setQueue] = useState<DispatchOrder[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [dispatchFilter, setDispatchFilter] = useState<OrderDispatchStatus | ''>('');
  const [stalledOnly, setStalledOnly] = useState(false);
  const [stalledTotal, setStalledTotal] = useState(0);
  const [stalledAfter, setStalledAfter] = useState(DEFAULT_STALLED_MINUTES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Any filter change invalidates the offset: page 3 of "all" is not page 3 of
  // "searching".
  useEffect(() => { setRiderPage(0); }, [riderStatus]);
  useEffect(() => { setQueuePage(0); }, [dispatchFilter, stalledOnly]);

  // Monotonic request ids. The 15s poll overlaps with filter changes and with
  // Refresh, and without these a slower in-flight response repaints rows that do
  // not match the filters now on screen. One counter each: a shared counter
  // would have the two loaders cancel each other on every refresh.
  const riderSeq = useRef(0);
  const queueSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const rSeq = ++riderSeq.current;
    const qSeq = ++queueSeq.current;
    try {
      const [rs, q] = await Promise.all([
        listRiders({ status: riderStatus || undefined, limit: PAGE_SIZE, offset: riderPage * PAGE_SIZE }),
        listDispatchQueue({
          dispatch: dispatchFilter || undefined,
          stalled: stalledOnly || undefined,
          limit: PAGE_SIZE,
          offset: queuePage * PAGE_SIZE,
        }),
      ]);
      if (rSeq === riderSeq.current) {
        setRiders(rs.items);
        setRiderCounts(rs.statusCounts);
        setRiderTotal(rs.total);
      }
      if (qSeq === queueSeq.current) {
        setQueue(q.items);
        setQueueTotal(q.total);
        setStalledTotal(q.stalledTotal);
        setStalledAfter(q.stalledAfterMinutes);
      }
    } catch (e) {
      if (rSeq === riderSeq.current) setError(String(e));
    } finally {
      if (rSeq === riderSeq.current) setLoading(false);
    }
  }, [riderStatus, riderPage, dispatchFilter, stalledOnly, queuePage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll for a "live-ish" board every 15s.
  useEffect(() => {
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  // What "needs attention" means on THIS board.
  //
  // It filtered on `no_rider` (a status orders.status cannot hold), then on
  // `dispatch_failed`. Both read 0 forever, for different reasons: the first is
  // not a real status, and the second IS real but terminal — the queue
  // deliberately excludes closed orders, because an order whose sourcing already
  // gave up needs a refund or a dispute, not a courier. Those used to make up
  // 183 of the board's 345 rows and buried the orders still worth acting on.
  //
  // The actionable state is an order still SEARCHING past the threshold: auto-
  // dispatch is running and getting nowhere, so a human offering it to a
  // specific rider is the intervention that helps.
  //
  // Both the count and the threshold come from the SERVER. Counting the rendered
  // array would mean "stalled among the 25 on this page", and hardcoding the
  // threshold would let the console and the backend disagree about what stalled
  // means.

  // Riders this operator can actually hand a job to, out of the roster page in
  // hand. Deliberately derived from the loaded rows, not from riderCounts: the
  // dropdown needs rider IDENTITIES, and a count cannot supply those. If the
  // available rider you want is not on this page, filter the roster to
  // "available" and the page will contain them.
  const assignable = riders.filter((r) => r.status === 'available');

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
        <KpiTile label="Available riders" value={String(riderCounts.available)} accent={colors.success} />
        <KpiTile label="On delivery" value={String(riderCounts.on_delivery)} accent={colors.info} />
        <KpiTile label="Queue" value={String(queueTotal)} sub="orders in dispatch flow" />
        <KpiTile
          label={`Stalled > ${stalledAfter}m`}
          value={String(stalledTotal)}
          accent={stalledTotal ? colors.danger : colors.success}
          sub="still searching, nobody has taken it"
        />
      </div>

      <Card title="Dispatch queue">
        {/* Filters are SERVER params — the board holds one page, so narrowing it
            locally would hide every match sitting on a later page. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
          {DISPATCH_TABS.map((d) => (
            <Button
              key={d || 'all'}
              sm
              variant={dispatchFilter === d ? 'primary' : 'outline'}
              onClick={() => setDispatchFilter(d)}
            >
              {d === '' ? 'All' : d.replace(/_/g, ' ')}
            </Button>
          ))}
          <Button
            sm
            variant={stalledOnly ? 'primary' : 'outline'}
            onClick={() => setStalledOnly((v) => !v)}
            title={`Still searching for longer than ${stalledAfter} minutes`}
          >
            {`Stalled only (${stalledTotal})`}
          </Button>
        </div>

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
                              {assignable.map((r) => (
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
                          {o.dispatch_status === 'searching' && (
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
            <Pager page={queuePage} total={queueTotal} count={queue.length} loading={loading} onPage={setQueuePage} />
          </div>
        )}
      </Card>

      <div style={{ height: '1.25rem' }} />

      <Card title="Riders">
        {/* Counts come from the server and span every status regardless of which
            tab is active, so a tab shows what selecting it would yield. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          {RIDER_STATUS_TABS.map((st) => (
            <Button
              key={st || 'all'}
              sm
              variant={riderStatus === st ? 'primary' : 'outline'}
              onClick={() => setRiderStatus(st)}
            >
              {st === ''
                ? `All (${Object.values(riderCounts).reduce((a, b) => a + b, 0)})`
                : `${st.replace(/_/g, ' ')} (${riderCounts[st] ?? 0})`}
            </Button>
          ))}
        </div>

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
            <Pager page={riderPage} total={riderTotal} count={riders.length} loading={loading} onPage={setRiderPage} />
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
