// ── Restaurant & Delivery — Formatters & helpers ─────────────────────────────
// All money is integer kobo. Display helpers convert to major units (NGN).

import type { Kobo, OrderStatus, DispatchStatus, FoodError, FoodErrorCode } from './types';

// ─── Money ──────────────────────────────────────────────────────────────────
export function formatNaira(kobo: Kobo, opts?: { decimals?: boolean }): string {
  const major = kobo / 100;
  const decimals = opts?.decimals === false ? 0 : 2;
  return `₦${major.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Whole-naira display, e.g. 250_000 → "₦2,500". */
export function formatNairaWhole(kobo: Kobo): string {
  return formatNaira(Math.round(kobo / 100) * 100, { decimals: false });
}

// ─── Distance ─────────────────────────────────────────────────────────────────
export function formatDistance(meters?: number): string {
  if (meters == null) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ─── Idempotency ────────────────────────────────────────────────────────────────
/** Generate an Idempotency-Key for a money mutation (matches mobility pattern). */
export function newIdempotencyKey(prefix = 'food'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Order status presentation ─────────────────────────────────────────────────
export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Payment confirmed',
  pending: 'Payment confirmed',
  accepted: 'Confirmed by restaurant',
  confirmed: 'Confirmed by restaurant',
  preparing: 'Preparing your food',
  ready: 'Ready for pickup',
  assigned: 'Rider assigned',
  picked_up: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  no_rider: 'No rider available',
};

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  placed: 'info',
  pending: 'info',
  accepted: 'info',
  confirmed: 'info',
  preparing: 'warning',
  ready: 'warning',
  assigned: 'info',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
  no_rider: 'danger',
};

/**
 * Normalize the backend's owner vocabulary onto the canonical app statuses so
 * timeline/index logic stays single-sourced: pending→placed, confirmed→accepted.
 */
export function normalizeStatus(status: OrderStatus): OrderStatus {
  if (status === 'pending') return 'placed';
  if (status === 'confirmed') return 'accepted';
  return status;
}

// Ordered timeline steps shown to the customer (terminal states handled separately).
export const TIMELINE_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Placed' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'preparing', label: 'Preparing' },
  { status: 'ready', label: 'Ready' },
  { status: 'picked_up', label: 'On the way' },
  { status: 'delivered', label: 'Delivered' },
];

const STATUS_ORDER: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'delivered',
];

/** Numeric progress index of a status (terminal/edge states return -1). */
export function statusIndex(status: OrderStatus): number {
  return STATUS_ORDER.indexOf(normalizeStatus(status));
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'delivered' || status === 'cancelled' || status === 'no_rider';
}

export function isLiveTrackable(status: OrderStatus): boolean {
  return status === 'assigned' || status === 'picked_up';
}

// ─── Dispatch presentation ──────────────────────────────────────────────────
/** Customer/owner-facing label for the server-side dispatch lifecycle. */
export const DISPATCH_LABEL: Record<DispatchStatus, string> = {
  none: 'Not dispatched yet',
  searching: 'Finding a rider…',
  assigned: 'Rider assigned',
  delivered: 'Delivered',
};

// ─── Error mapping ────────────────────────────────────────────────────────────
export function toFoodError(err: unknown): FoodError {
  const e = err as {
    response?: { status?: number; data?: { error?: string; code?: FoodErrorCode } };
    message?: string;
    code?: FoodErrorCode;
    status?: number;
  };
  const status = e?.response?.status ?? e?.status;
  const code = e?.response?.data?.code ?? e?.code;
  const message =
    e?.response?.data?.error ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(message) as FoodError;
  out.code = code;
  out.status = status;
  return out;
}

export function isNoRiderError(err: FoodError): boolean {
  return err.code === 'NO_RIDER_FOUND';
}

export function relativeTime(iso: string): string {
  const then = +new Date(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}
