// Events commerce admin: refund desk + organiser payouts. Live routes are
// /api/events/admin/* (backend/internal/top5events/commerce_handler.go
// RegisterCommerce, handler_payouts.go RegisterPayouts). Both route groups are
// feature-flagged server-side, so with the flag off every call here 404s.
// Same mock/live switch as eventsAdminService (NEXT_PUBLIC_EVENTS_USE_MOCK):
// mock READS return small fixtures; mock WRITES throw, because this console must
// never report a write it did not perform. Money is integer kobo.

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';
import type {
  EventRefund, RefundQueueStats, OrganiserPayout, PayoutQueueLine, PayoutStatement,
} from '@/types/eventsCommerceAdmin';

export const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_EVENTS_USE_MOCK);
export const USE_MOCK_ENV = 'NEXT_PUBLIC_EVENTS_USE_MOCK';

const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_EVENTS_USE_MOCK=false to make this change against the live backend.';

const base = () => `${apiRoot()}/api/events/admin`;
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// The Go handlers answer errors as {"error": "..."}; surface that text so a 409
// ("already decided") reads as a reason rather than a bare status code.
async function call<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${base()}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error ? `${j.error} (${res.status})` : `Request failed (${res.status})`);
  // Payout reads wrap their list under a named key ("payouts" / "queue"), the
  // rest under "data".
  return (opts.key ? j?.[opts.key] : j?.data) as T;
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// --- refund desk (guard events.refund) ---

const REFUNDS: EventRefund[] = [
  { id: 'rf_mock_1', event_id: 'evt_mock_1', order_id: 'ord_mock_1', ticket_id: 'tkt_mock_1', buyer_id: 'usr_mock_1', amount_kobo: 15_000_00, fee_kobo: 750_00, refund_kobo: 14_250_00, reason: 'Cannot attend — travel', status: 'REQUESTED', created_at: iso(5), event_title: 'Fixture Concert', tier_name: 'Regular', buyer_name: 'Fixture Buyer A', booking_ref: 'BK-MOCK1' },
  { id: 'rf_mock_2', event_id: 'evt_mock_1', order_id: 'ord_mock_2', ticket_id: 'tkt_mock_2', buyer_id: 'usr_mock_2', amount_kobo: 50_000_00, fee_kobo: 2_500_00, refund_kobo: 47_500_00, status: 'FAILED', created_at: iso(30), failure_reason: 'ledger leg failed', event_title: 'Fixture Concert', tier_name: 'VIP', buyer_name: 'Fixture Buyer B', booking_ref: 'BK-MOCK2' },
];

export async function listRefunds(o: { status?: string; event_id?: string; q?: string } = {}): Promise<EventRefund[]> {
  if (USE_MOCK) {
    await delay();
    const q = o.q?.toLowerCase();
    return REFUNDS.filter((r) => (!o.status || r.status === o.status) && (!o.event_id || r.event_id === o.event_id)
      && (!q || [r.event_title, r.reason, r.booking_ref, r.buyer_name].some((v) => v?.toLowerCase().includes(q))));
  }
  return (await call<EventRefund[]>('GET', `/refunds${qs({ ...o, limit: '200' })}`)) ?? [];
}

export async function getRefundStats(): Promise<RefundQueueStats> {
  if (USE_MOCK) { await delay(); return { requested: 1, processing: 0, failed: 1, refunded: 0, rejected: 0 }; }
  return call<RefundQueueStats>('GET', '/refunds/stats');
}

export async function decideRefund(id: string, approve: boolean, note: string): Promise<EventRefund> {
  if (USE_MOCK) throw new Error(`Deciding a refund ${NOT_IN_FIXTURE_MODE}`);
  return call<EventRefund>('POST', `/refunds/${encodeURIComponent(id)}/decide`, { body: { approve, note } });
}

/** Pays an approved refund. The ledger keys on the refund id server-side; the
 *  header is still sent so every money mutation from this console carries one. */
export async function executeRefund(id: string, idempotencyKey: string): Promise<EventRefund> {
  if (USE_MOCK) throw new Error(`Executing a refund ${NOT_IN_FIXTURE_MODE}`);
  return call<EventRefund>('POST', `/refunds/${encodeURIComponent(id)}/execute`, { body: {}, idempotencyKey });
}

// --- organiser payouts (reads events.admin.view, writes events.settle) ---

const PAYOUTS: OrganiserPayout[] = [
  { id: 'po_mock_1', event_id: 'evt_mock_2', organiser_id: 'org_mock_1', status: 'pending', gross_kobo: 1_000_000_00, fee_kobo: 50_000_00, net_kobo: 855_000_00, reserve_held_kobo: 95_000_00, fee_bps: 500, reserve_bps: 1000, refunds_kobo: 0, disputed_kobo: 0, destination: 'wallet', idempotency_key: 'mock-1', requested_by: 'usr_mock_org', created_at: iso(10) },
  { id: 'po_mock_2', event_id: 'evt_mock_3', organiser_id: 'org_mock_2', status: 'paid', gross_kobo: 400_000_00, fee_kobo: 20_000_00, net_kobo: 380_000_00, reserve_held_kobo: 0, fee_bps: 500, reserve_bps: 0, refunds_kobo: 15_000_00, disputed_kobo: 0, destination: 'wallet', idempotency_key: 'mock-2', requested_by: 'usr_mock_org2', approved_by: 'usr_mock_admin', created_at: iso(200), paid_at: iso(190) },
];
const QUEUE: PayoutQueueLine[] = [
  { event_id: 'evt_mock_2', event_title: 'Fixture Festival', organiser_id: 'org_mock_1', ends_at: iso(96), eligible: true, eligible_at: iso(24), available_kobo: 0, pending_kobo: 855_000_00, paid_kobo: 0, reserve_kobo: 95_000_00, in_flight_payout_id: 'po_mock_1' },
  { event_id: 'evt_mock_4', event_title: 'Fixture Comedy Night', organiser_id: 'org_mock_3', ends_at: iso(20), eligible: false, reason: 'hold_window', eligible_at: iso(-52), available_kobo: 0, pending_kobo: 0, paid_kobo: 0, reserve_kobo: 0 },
];

export async function listPayouts(status?: string): Promise<OrganiserPayout[]> {
  if (USE_MOCK) { await delay(); return PAYOUTS.filter((p) => !status || p.status === status); }
  return (await call<OrganiserPayout[]>('GET', `/payouts${qs({ status })}`, { key: 'payouts' })) ?? [];
}

export async function getPayoutQueue(): Promise<PayoutQueueLine[]> {
  if (USE_MOCK) { await delay(); return [...QUEUE]; }
  return (await call<PayoutQueueLine[]>('GET', '/payouts/queue', { key: 'queue' })) ?? [];
}

export async function getPayoutStatement(eventId: string): Promise<PayoutStatement> {
  if (USE_MOCK) {
    await delay();
    const line = QUEUE.find((l) => l.event_id === eventId) ?? QUEUE[0];
    return {
      eligible: line.eligible, reason: line.reason, eligible_at: line.eligible_at, reserve_active: line.reserve_kobo > 0, reserve_release_at: iso(-600),
      event_id: line.event_id, event_title: line.event_title, event_state: 'CLOSED', ends_at: line.ends_at, organiser_id: line.organiser_id,
      fee_bps: 500, reserve_bps: 1000, gross_sales_kobo: 1_000_000_00, refunds_kobo: 0, disputed_held_kobo: 0, eligible_gross_kobo: 1_000_000_00,
      fees_kobo: 50_000_00, reserve_kobo: line.reserve_kobo, net_earnings_kobo: 855_000_00, paid_kobo: line.paid_kobo, fees_collected_kobo: 0,
      pending_kobo: line.pending_kobo, balance_kobo: 0, available_kobo: line.available_kobo, payouts: PAYOUTS.filter((p) => p.event_id === line.event_id),
    };
  }
  return call<PayoutStatement>('GET', `/events/${encodeURIComponent(eventId)}/payout-statement`);
}

/** Checker step: moves money escrow -> organiser wallet. Maker can never approve. */
export async function approvePayout(id: string, idempotencyKey: string): Promise<OrganiserPayout> {
  if (USE_MOCK) throw new Error(`Approving a payout ${NOT_IN_FIXTURE_MODE}`);
  return call<OrganiserPayout>('POST', `/payouts/${encodeURIComponent(id)}/approve`, { body: {}, idempotencyKey });
}

/** Checker rejection: no money moves; reason is required server-side. */
export async function rejectPayout(id: string, reason: string): Promise<OrganiserPayout> {
  if (USE_MOCK) throw new Error(`Rejecting a payout ${NOT_IN_FIXTURE_MODE}`);
  return call<OrganiserPayout>('POST', `/payouts/${encodeURIComponent(id)}/reject`, { body: { reason } });
}
