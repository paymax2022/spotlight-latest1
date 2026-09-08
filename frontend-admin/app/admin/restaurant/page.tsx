'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listOrders, listRestaurants } from '@/services/restaurantAdminService';
import { ORDER_STATUSES, isTerminalOrderStatus } from '@/types/restaurantAdmin';
import type {
  AdminOrderPage,
  AdminRestaurantQuery,
  AdminRestaurantRow,
  OrderStatus,
} from '@/types/restaurantAdmin';
import { naira } from './_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// The chips the queue filters on. They used to read placed / accepted /
// assigned / refunded / no_rider — five values `orders.status` cannot hold, so
// five chips could never match a row — while pending, confirmed, rejected,
// dispatch_failed and delivery_failed, which do occur, had no chip at all.
// ORDER_STATUSES is the CHECK-constraint vocabulary; the feed 400s on anything
// outside it, so drift here is loud rather than silently empty.
const STATUS_FILTERS: (OrderStatus | '')[] = ['', ...ORDER_STATUSES];

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
};

// `dispatch_failed` reads as a column name; the chips and badges show
// "dispatch failed". The VALUE sent to the server is never touched.
const prettyStatus = (s: string) => s.replace(/_/g, ' ');

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

const PAGE_SIZE = 25;

const AVAILABILITY: { key: NonNullable<AdminRestaurantQuery['status']>; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

// listing_review_status values on `restaurants`. A shop sitting in any state but
// APPROVED is one moderation has not let through — the register exists so those
// are visible at all.
const REVIEW_STATES = ['', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'];

const REVIEW_COLOR: Record<string, string> = {
  APPROVED: colors.success,
  PENDING_REVIEW: colors.warning,
  CHANGES_REQUESTED: colors.warning,
  REJECTED: colors.danger,
  DRAFT: colors.secondary,
};

export default function RestaurantAdminPage() {
  const router = useRouter();

  // ── Restaurant register (paged, server-filtered) ──────────────────────────
  const [restaurants, setRestaurants] = useState<AdminRestaurantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openTotal, setOpenTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState<NonNullable<AdminRestaurantQuery['status']>>('all');
  const [review, setReview] = useState('');
  const [rLoading, setRLoading] = useState(true);
  const [rError, setRError] = useState<string | null>(null);

  // ── Order queue (paged, server-filtered, server-aggregated) ───────────────
  const [orderPage, setOrderPage] = useState<AdminOrderPage | null>(null);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [oPage, setOPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounced so typing in the search box is one request per settled term
  // rather than one per keystroke — the filter runs in SQL now, not in the page.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  // Any filter change invalidates the current offset: page 4 of "all" is not
  // page 4 of "closed".
  useEffect(() => { setPage(0); }, [debouncedSearch, availability, review]);
  useEffect(() => { setOPage(0); }, [status, debouncedOrderSearch, unassignedOnly]);

  // Monotonic request id. Filter changes fire overlapping requests (debounce
  // narrows the window, it does not close it — switching Open→Closed while a
  // search is in flight is enough), and without this the SLOWER response wins
  // and paints rows that do not match the filters now on screen.
  const reqSeq = useRef(0);

  // The order feed gets its OWN counter rather than sharing reqSeq: the two
  // loaders run concurrently (the Refresh button fires both), and one shared
  // counter would have each cancel the other's in-flight response.
  const orderSeq = useRef(0);

  const loadRestaurants = useCallback(async () => {
    const seq = ++reqSeq.current;
    setRLoading(true); setRError(null);
    try {
      const res = await listRestaurants({
        q: debouncedSearch,
        status: availability,
        review: review || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (seq !== reqSeq.current) return; // superseded
      setRestaurants(res.items);
      setTotal(res.total);
      setOpenTotal(res.openTotal);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setRError(String(e));
    } finally {
      if (seq === reqSeq.current) setRLoading(false);
    }
  }, [debouncedSearch, availability, review, page]);

  useEffect(() => { void loadRestaurants(); }, [loadRestaurants]);

  // Same monotonic-sequence guard as the register above, for the same reason:
  // clicking a status chip while a search request is in flight fires two
  // overlapping loads, and without this the slower one paints rows that do not
  // match the filters now on screen.
  const loadOrders = useCallback(async () => {
    const seq = ++orderSeq.current;
    setLoading(true); setError(null);
    try {
      const res = await listOrders({
        status: status || undefined,
        q: debouncedOrderSearch,
        unassigned: unassignedOnly || undefined,
        limit: PAGE_SIZE,
        offset: oPage * PAGE_SIZE,
      });
      if (seq !== orderSeq.current) return; // superseded
      setOrderPage(res);
    } catch (e) {
      if (seq !== orderSeq.current) return;
      setError(String(e));
    } finally {
      if (seq === orderSeq.current) setLoading(false);
    }
  }, [status, debouncedOrderSearch, unassignedOnly, oPage]);
  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const orders = orderPage?.items ?? [];
  const statusCounts = orderPage?.statusCounts;

  // Every order figure below is a SERVER aggregate over the whole filtered set.
  // They were counted off the loaded array, which was survivable only while the
  // page held every order it could see (zero, as it turned out — the owner-scoped
  // route it called returns none of the platform's 2,174). Paged, that same
  // arithmetic would have made "Active orders" mean "active among the 25 on
  // screen". status_counts deliberately ignores the status filter, so the
  // Delivered and dispatch-failed tiles hold steady while you click through chips.
  const activeCount = orderPage?.activeTotal ?? 0;
  const deliveredCount = statusCounts?.delivered ?? 0;
  // The honest replacement for the old "No-rider" tile: dispatch_failed is the
  // state an order lands in when the broadcast rounds run out with no taker.
  const stuckCount = statusCounts?.dispatch_failed ?? 0;
  const grossKobo = orderPage?.grossDeliveredKobo ?? 0;

  const orderTotal = orderPage?.total ?? 0;
  const oFirstRow = orderTotal === 0 ? 0 : oPage * PAGE_SIZE + 1;
  const oLastRow = Math.min(orderTotal, oPage * PAGE_SIZE + orders.length);
  // The "All" chip's count: status_counts spans every status under the other
  // filters, so summing it is the same number the unfiltered feed reports.
  const allOrderCount = statusCounts
    ? Object.values(statusCounts).reduce((a, b) => a + b, 0)
    : 0;
  const orderFiltersActive = Boolean(debouncedOrderSearch || unassignedOnly || status);

  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = Math.min(total, page * PAGE_SIZE + restaurants.length);
  const filtersActive = Boolean(debouncedSearch || review || availability !== 'all');

  return (
    <Page>
      <PageHeader
        title="Restaurant & Delivery"
        subtitle="Every restaurant on the platform, and the live order queue."
        actions={
          <Button variant="outline" onClick={() => { void loadRestaurants(); void loadOrders(); }}>
            Refresh
          </Button>
        }
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {/* Both figures are SERVER counts over the current filters. They used to be
            `restaurants.length` over a list the discovery endpoint had already
            narrowed to is_open=TRUE, so "Restaurants" and "open" were the same
            number and neither was the platform total. */}
        <KpiTile
          label={filtersActive ? 'Restaurants (filtered)' : 'Restaurants'}
          value={total.toLocaleString('en-NG')}
          accent={colors.primary}
          sub={`${openTotal.toLocaleString('en-NG')} open · ${(total - openTotal).toLocaleString('en-NG')} closed`}
        />
        {/* Server aggregates over the whole filtered order set, not the page. */}
        <KpiTile
          label="Active orders"
          value={activeCount.toLocaleString('en-NG')}
          accent={activeCount ? colors.warning : colors.success}
          sub="pending → picked up"
        />
        <KpiTile label="Delivered" value={deliveredCount.toLocaleString('en-NG')} accent={colors.success} />
        <KpiTile
          label="Dispatch failed"
          value={stuckCount.toLocaleString('en-NG')}
          accent={stuckCount ? colors.danger : colors.success}
          sub="No rider took the job"
        />
        <KpiTile label="Gross (delivered)" value={naira(grossKobo)} sub="Integer kobo, delivered only" />
      </div>

      <Card title="Restaurants" style={{ marginBottom: '1.25rem' }}>
        {/* Search + filters are SERVER params. The console previously held every
            row it could see and had no filters at all. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, address or cuisine…"
            aria-label="Search restaurants"
            style={{
              flex: '1 1 240px', minWidth: 220, padding: '0.5rem 0.7rem', fontSize: '0.85rem',
              border: `1px solid ${colors.border}`, borderRadius: 6, background: 'transparent', color: colors.text,
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {AVAILABILITY.map((a) => (
              <Button key={a.key} sm variant={availability === a.key ? 'primary' : 'outline'} onClick={() => setAvailability(a.key)}>
                {a.label}
              </Button>
            ))}
          </div>
          <select
            value={review}
            onChange={(e) => setReview(e.target.value)}
            aria-label="Listing review status"
            style={{
              padding: '0.45rem 0.6rem', fontSize: '0.8rem', border: `1px solid ${colors.border}`,
              borderRadius: 6, background: 'transparent', color: colors.text,
            }}
          >
            {REVIEW_STATES.map((v) => (
              <option key={v || 'any'} value={v}>{v ? v.replace(/_/g, ' ') : 'Any review state'}</option>
            ))}
          </select>
        </div>

        {rError && <p style={{ color: colors.danger }}>{rError}</p>}

        {rLoading && restaurants.length === 0 ? (
          <p style={{ color: colors.muted }}>Loading restaurants…</p>
        ) : restaurants.length === 0 ? (
          <p style={{ color: colors.muted }}>
            {filtersActive ? 'No restaurants match these filters.' : 'No restaurants.'}
          </p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Name</th>
                    <th style={thCell}>Cuisine</th>
                    <th style={thCell}>Address</th>
                    <th style={thCell}>State</th>
                    <th style={thCell}>Listing</th>
                    <th style={thCell}>Menu</th>
                    <th style={thCell}>Rating</th>
                    <th style={thCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {restaurants.map((r) => (
                    <tr key={r.id}>
                      <td style={tdCell}><strong>{r.name}</strong></td>
                      <td style={tdCell}>{r.cuisine || '—'}</td>
                      <td style={tdCell}>{r.address || '—'}</td>
                      <td style={tdCell}><StatusBadge status={r.is_open ? 'delivered' : 'cancelled'} label={r.is_open ? 'Open' : 'Closed'} /></td>
                      {/* Why a shop is not live. Invisible before, because the
                          console could only ever see approved, open rows. */}
                      <td style={tdCell}>
                        {r.listing_review_status ? (
                          <Badge
                            text={r.listing_review_status.replace(/_/g, ' ')}
                            color={REVIEW_COLOR[r.listing_review_status] ?? colors.secondary}
                          />
                        ) : '—'}
                      </td>
                      <td style={tdCell}>
                        {r.menu_item_count === 0
                          ? <span style={{ color: colors.warning }}>empty</span>
                          : `${r.menu_item_count ?? '—'} items`}
                      </td>
                      <td style={tdCell}>{r.rating?.toFixed(1) ?? '—'}</td>
                      {/* The list was read-only with no way into a store. This is the
                          entry point to profile edit, force open/close and menu CRUD. */}
                      <td style={tdCell}>
                        <Button variant="outline" sm onClick={() => router.push(`/admin/restaurant/${r.id}`)}>
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: colors.muted }}>
                {`Showing ${firstRow.toLocaleString('en-NG')}–${lastRow.toLocaleString('en-NG')} of ${total.toLocaleString('en-NG')}`}
                {rLoading ? ' · refreshing…' : ''}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button sm variant="outline" disabled={page === 0 || rLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Previous
                </Button>
                <span style={{ fontSize: '0.8rem', color: colors.muted }}>
                  Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </span>
                <Button sm variant="outline" disabled={lastRow >= total || rLoading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Each chip carries its own count, from status_counts — which is computed
          with the status filter EXCLUDED, so the numbers say what selecting the
          chip would yield instead of collapsing to the one already in effect. */}
      <div style={{ display: 'flex', gap: 6, margin: '1.25rem 0 1rem', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => {
          const n = s ? statusCounts?.[s] ?? 0 : allOrderCount;
          return (
            <Button
              key={s || 'all'}
              sm
              variant={status === s ? 'primary' : 'outline'}
              onClick={() => setStatus(s)}
            >
              {s ? prettyStatus(s) : 'All'} · {n.toLocaleString('en-NG')}
            </Button>
          );
        })}
      </div>

      <Card title="Order queue">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
          {/* q ILIKEs the order id, restaurant name and delivery address in SQL.
              The id is cast to text before matching, so an operator holding a
              fragment like "3f2a" off a support ticket finds the row without
              knowing the full uuid. Debounced 300ms: one request per settled
              term, not one per keystroke. */}
          <input
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Search order id, restaurant or address…"
            aria-label="Search orders"
            style={{
              flex: '1 1 240px', minWidth: 220, padding: '0.5rem 0.7rem', fontSize: '0.85rem',
              border: `1px solid ${colors.border}`, borderRadius: 6, background: 'transparent', color: colors.text,
            }}
          />
          {/* "Nobody is carrying this": no rider AND not already closed. An
              unassigned delivered order is not a dispatch problem. */}
          <Button
            sm
            variant={unassignedOnly ? 'primary' : 'outline'}
            onClick={() => setUnassignedOnly((v) => !v)}
            title="Open orders with no rider assigned"
          >
            Unassigned only
          </Button>
        </div>

        {loading && orders.length === 0 ? (
          <p style={{ color: colors.muted }}>Loading orders…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: colors.muted }}>
            {orderFiltersActive ? 'No orders match these filters.' : 'No orders.'}
          </p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Order</th>
                    <th style={thCell}>Restaurant</th>
                    <th style={thCell}>Customer</th>
                    <th style={thCell}>Rider</th>
                    <th style={thCell}>Items</th>
                    <th style={thCell}>Age</th>
                    <th style={thCell}>Delivery</th>
                    <th style={thCell}>Total</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td style={tdCell} title={o.id}>{o.id.slice(0, 10)}</td>
                      <td style={tdCell}>{o.restaurant_name || o.restaurant_id}</td>
                      <td style={tdCell} title={o.customer_id}>{o.customer_id.slice(0, 10)}…</td>
                      {/* The name, with the id only as a tooltip. This column used
                          to print the raw rider uuid, which tells an operator
                          nothing about who to call. */}
                      <td style={tdCell} title={o.rider_id ?? undefined}>
                        {o.rider_name || o.rider_id || <span style={{ color: colors.muted }}>unassigned</span>}
                      </td>
                      {/* SUM(order_items.quantity), pre-aggregated server-side —
                          the admin feed does not ship line items. */}
                      <td style={tdCell}>{o.item_count}</td>
                      {/* Server-computed, so every operator's console agrees
                          regardless of clock skew. Terminal orders are not
                          "waiting", and the server reports 0 for them. */}
                      <td style={tdCell}>
                        {isTerminalOrderStatus(o.status)
                          ? <span style={{ color: colors.muted }}>—</span>
                          : `${o.age_minutes}m`}
                      </td>
                      <td style={tdCell}>{naira(o.delivery_fee_kobo)}</td>
                      <td style={tdCell}><strong>{naira(o.total_kobo)}</strong></td>
                      {/* status_reason is the operator-visible why on a rejected
                          or failed order; surfaced on hover rather than widening
                          the table for the rows that do not have one. */}
                      <td style={tdCell} title={o.status_reason ?? undefined}>
                        <StatusBadge status={o.status} label={prettyStatus(o.status)} />
                      </td>
                      <td style={tdCell}>{new Date(o.created_at).toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: colors.muted }}>
                {`Showing ${oFirstRow.toLocaleString('en-NG')}–${oLastRow.toLocaleString('en-NG')} of ${orderTotal.toLocaleString('en-NG')}`}
                {loading ? ' · refreshing…' : ''}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button sm variant="outline" disabled={oPage === 0 || loading} onClick={() => setOPage((p) => Math.max(0, p - 1))}>
                  Previous
                </Button>
                <span style={{ fontSize: '0.8rem', color: colors.muted }}>
                  Page {oPage + 1} of {Math.max(1, Math.ceil(orderTotal / PAGE_SIZE))}
                </span>
                <Button sm variant="outline" disabled={oLastRow >= orderTotal || loading} onClick={() => setOPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Requires the <code>restaurant.manage</code> RBAC permission. The restaurant table is the
        full register — every row in <code>restaurants</code>, open or closed, approved or not —
        served paged from <code>GET /api/restaurant/admin/restaurants</code>. Order mutations happen
        in the customer / restaurant / rider apps; the queue above is the read-only platform-wide
        feed <code>GET /api/restaurant/admin/orders</code>, whose KPI figures are server aggregates
        over the whole filtered set rather than the page on screen.
      </p>
    </Page>
  );
}
