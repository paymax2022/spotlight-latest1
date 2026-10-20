// Pure helpers for the order-type UX (FOOD-UAT-D-007): labels, pickup slot
// generation, dine-in validation and per-type capability flags. No React / RN
// imports so node:test can run it. The server is authoritative for every rule
// here (backend/internal/restaurant/order_types.go) — this only avoids sending
// requests it will reject.

import type { Order, OrderType } from './types';

export type FulfilmentChoice = 'delivery' | 'pickup' | 'dine_in';

export const SLOT_STEP_MIN = 15;
/** Backend `pickupScheduledWindow` — a slot may be at most this far ahead. */
export const SLOT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Minimum lead so the kitchen is not asked for a slot that is already gone. */
export const SLOT_MIN_LEAD_MIN = 15;
export const MAX_TABLE_LEN = 20;
export const MAX_PARTY_SIZE = 20;

export const CHOICE_LABEL: Record<FulfilmentChoice, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  dine_in: 'Reserve dine-in',
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  delivery: 'Delivery',
  pickup_now: 'Pickup',
  pickup_scheduled: 'Scheduled pickup',
  dine_in: 'Dine-in',
};

export function orderTypeOf(order: Pick<Order, 'orderType'> | undefined | null): OrderType {
  return order?.orderType ?? 'delivery';
}

export const isPickup = (t: OrderType) => t === 'pickup_now' || t === 'pickup_scheduled';
/** Only delivery uses dispatch, the delivery fee, tip and a rider. */
export const usesRider = (t: OrderType) => t === 'delivery';

/** Maps the selector state to the wire `order_type`. */
export function toOrderType(choice: FulfilmentChoice, scheduled: boolean): OrderType {
  if (choice === 'pickup') return scheduled ? 'pickup_scheduled' : 'pickup_now';
  return choice;
}

/** Choices to offer. Dine-in is hidden unless the restaurant has it enabled. */
export function availableChoices(opts: { dineInEnabled?: boolean }): FulfilmentChoice[] {
  return opts.dineInEnabled ? ['delivery', 'pickup', 'dine_in'] : ['delivery', 'pickup'];
}

/**
 * Pickup slots: next 24h in 15-minute steps, starting at least SLOT_MIN_LEAD_MIN
 * from `now` (rounded up to the grid). `isOpenAt` lets the caller apply store
 * hours; when it is omitted every slot is offered.
 */
export function buildPickupSlots(now: Date, isOpenAt?: (d: Date) => boolean): Date[] {
  const stepMs = SLOT_STEP_MIN * 60_000;
  const earliest = now.getTime() + SLOT_MIN_LEAD_MIN * 60_000;
  const start = Math.ceil(earliest / stepMs) * stepMs;
  const end = now.getTime() + SLOT_WINDOW_MS;
  const out: Date[] = [];
  for (let t = start; t <= end; t += stepMs) {
    const d = new Date(t);
    if (!isOpenAt || isOpenAt(d)) out.push(d);
  }
  return out;
}

export function isSlotValid(slot: Date, now: Date): boolean {
  const t = slot.getTime();
  return t > now.getTime() && t <= now.getTime() + SLOT_WINDOW_MS;
}

export interface DineInInput {
  partySize: number;
  tablePreference?: string;
}

/** Returns an error message, or null when the reservation input is acceptable. */
export function validateDineIn(input: DineInInput): string | null {
  if (!Number.isInteger(input.partySize) || input.partySize < 1) return 'Enter how many people are dining.';
  if (input.partySize > MAX_PARTY_SIZE) return `Parties are limited to ${MAX_PARTY_SIZE} people.`;
  if ((input.tablePreference ?? '').trim().length > MAX_TABLE_LEN) return 'Table preference is too long.';
  return null;
}

/**
 * The backend requires a non-empty `table_number` at placement for dine_in (the
 * restaurant may reassign it later). Until a table is picked we send a
 * descriptive placeholder carrying the party size so the kitchen sees it.
 */
export function dineInTableNumber(input: DineInInput): string {
  const pref = (input.tablePreference ?? '').trim();
  return (pref || `Party of ${input.partySize}`).slice(0, MAX_TABLE_LEN);
}

/** Customer-facing headline for a pickup/dine-in order. */
export function fulfilmentHeadline(order: Pick<Order, 'orderType' | 'status' | 'tableNumber'>): string {
  const t = orderTypeOf(order);
  const st = order.status;
  if (t === 'dine_in') {
    if (st === 'served') return 'Enjoy your meal';
    if (st === 'closed') return 'Visit complete';
    if (st === 'cancelled') return 'Reservation cancelled';
    if (st === 'preparing') return order.tableNumber ? `Preparing — table ${order.tableNumber}` : 'Preparing your order';
    if (st === 'accepted' || st === 'confirmed') return order.tableNumber ? `Table assigned: ${order.tableNumber}` : 'Reservation confirmed';
    return 'Waiting for the restaurant to confirm';
  }
  if (isPickup(t)) {
    if (st === 'ready') return 'Ready for pickup';
    if (st === 'picked_up' || st === 'delivered') return 'Collected';
    if (st === 'preparing') return 'Preparing your order';
    if (st === 'cancelled') return 'Order cancelled';
    return 'Waiting for the restaurant to confirm';
  }
  return '';
}

/** Merchant-side actions allowed for the order's current state. */
export interface MerchantActions {
  canVerifyCode: boolean;
  canAssignTable: boolean;
  canServe: boolean;
  canClose: boolean;
  /** Show rider dispatch controls (delivery only). */
  showRider: boolean;
}

export function merchantActions(order: Pick<Order, 'orderType' | 'status'>): MerchantActions {
  const t = orderTypeOf(order);
  const st = order.status;
  const live = st !== 'cancelled' && st !== 'closed' && st !== 'delivered';
  return {
    canVerifyCode: isPickup(t) && st === 'ready',
    canAssignTable: t === 'dine_in' && live && (st === 'pending' || st === 'placed' || st === 'confirmed' || st === 'accepted' || st === 'preparing'),
    canServe: t === 'dine_in' && st === 'preparing',
    canClose: t === 'dine_in' && st === 'served',
    showRider: usesRider(t),
  };
}

/** Customer can signal arrival once a pickup order is being prepared or ready. */
export function canSignalArrival(order: Pick<Order, 'orderType' | 'status' | 'arrivedAt'>): boolean {
  return (
    isPickup(orderTypeOf(order)) &&
    (order.status === 'preparing' || order.status === 'ready') &&
    !order.arrivedAt
  );
}
