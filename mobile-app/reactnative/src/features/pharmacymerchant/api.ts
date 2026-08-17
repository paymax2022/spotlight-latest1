// ── Pharmacy merchant — API wrapper ──────────────────────────────────────────
//
// The pharmacist's side of the health pharmacy module: the order inbox and the
// fulfilment lifecycle. Distinct from src/features/health/pharmacy, which is the
// CUSTOMER side (browse, cart, checkout, track).
//
// Live by default, like the other merchant modules. Money moves on these calls —
// completing an order releases the pharmacy's payment out of escrow — so every
// mutation carries an Idempotency-Key.

import { api } from '@/api/client';
import type { PharmacyOrderState } from './actions';

const BASE = '/api/finance/health/pharmacy';

/** An order as the owner inbox returns it. */
export interface PharmacyOrder {
  id: string;
  patient_id: string;
  pharmacy_provider_id: string;
  prescription_id?: string | null;
  state: PharmacyOrderState | string;
  fulfilment_method: string;
  total_kobo: number;
  escrow_id?: string | null;
  delivery_ref?: string | null;
  created_at: string;
  lines?: PharmacyOrderLine[];
  // NOTE: no pickup_code. The server withholds it from every reader who is not
  // the patient — it is the credential they present at the counter.
}

export interface PharmacyOrderLine {
  product_id?: string;
  name?: string;
  quantity?: number;
  unit_price_kobo?: number;
}

const idem = (key: string) => ({ headers: { 'Idempotency-Key': key } });

/** A fresh key per attempt; a retry of the SAME attempt must reuse its key. */
export function newIdempotencyKey(prefix: string): string {
  const rand = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${rand}`;
}

/**
 * The inbox. Scoped server-side to pharmacies the caller OWNS — there is no
 * pharmacy id to pass, and passing one would not widen it.
 */
export async function listOrders(state?: string): Promise<PharmacyOrder[]> {
  const { data } = await api.get<{ orders?: PharmacyOrder[] }>(`${BASE}/orders`, {
    params: state ? { state } : undefined,
  });
  // Non-array defensively: callers sort and filter this directly.
  return Array.isArray(data?.orders) ? data.orders : [];
}

export async function getOrder(id: string): Promise<PharmacyOrder> {
  const { data } = await api.get<{ order: PharmacyOrder }>(`${BASE}/orders/${encodeURIComponent(id)}`);
  return data.order;
}

export async function confirmOrder(id: string, key: string): Promise<void> {
  await api.post(`${BASE}/orders/${encodeURIComponent(id)}/confirm`, {}, idem(key));
}

/**
 * Record what was actually dispensed. The server matches it against the
 * prescription (DP-002/DP-003) and rejects a drug that was not prescribed.
 */
export async function dispenseOrder(id: string, key: string): Promise<void> {
  await api.post(`${BASE}/orders/${encodeURIComponent(id)}/dispense`, {}, idem(key));
}

/** Hand to the delivery rail, or set aside for collection. */
export async function dispatchOrder(id: string, method: 'DELIVERY' | 'PICKUP', key: string): Promise<void> {
  await api.post(`${BASE}/orders/${encodeURIComponent(id)}/dispatch`, { fulfilment_method: method }, idem(key));
}

/**
 * Close out the order and release the pharmacy's payment.
 *
 * For a collection the patient's pickup code is required — the pharmacy is not
 * told it, so this is the code the customer shows at the counter and the server
 * verifies. A mismatch is rejected server-side.
 */
export async function completeOrder(id: string, pickupCode: string | undefined, key: string): Promise<void> {
  await api.post(
    `${BASE}/orders/${encodeURIComponent(id)}/complete`,
    pickupCode ? { pickup_code: pickupCode } : {},
    idem(key),
  );
}
