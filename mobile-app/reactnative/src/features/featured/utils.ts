// ── Featured Placement — Formatters & helpers ─────────────────────────────────
// All money is integer kobo. Re-uses the canonical formatNaira so currency
// display matches the rest of the app.

import { formatNaira } from '@/features/food/utils';
import type { CampaignState, FeaturedError } from './types';

export { formatNaira };

// ─── Idempotency ──────────────────────────────────────────────────────────────
/** Generate an Idempotency-Key for a money mutation (matches food pattern). */
export function newIdempotencyKey(prefix = 'featured'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Campaign state presentation ──────────────────────────────────────────────
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATE_LABEL: Record<CampaignState, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  NEEDS_MORE_INFO: 'Needs info',
  REJECTED: 'Rejected',
  PENDING_PAYMENT: 'Awaiting payment',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  CANCELLED_EARLY: 'Cancelled',
  COMPLETED: 'Completed',
};

export const STATE_TONE: Record<CampaignState, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  NEEDS_MORE_INFO: 'warning',
  REJECTED: 'danger',
  PENDING_PAYMENT: 'warning',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'danger',
  CANCELLED_EARLY: 'danger',
  COMPLETED: 'neutral',
};

export function isTerminalState(s: CampaignState): boolean {
  return s === 'REJECTED' || s === 'CANCELLED' || s === 'CANCELLED_EARLY' || s === 'COMPLETED';
}

export function canPause(s: CampaignState): boolean {
  return s === 'ACTIVE';
}
export function canResume(s: CampaignState): boolean {
  return s === 'PAUSED';
}
export function canCancel(s: CampaignState): boolean {
  return (
    s === 'DRAFT' ||
    s === 'SUBMITTED' ||
    s === 'UNDER_REVIEW' ||
    s === 'NEEDS_MORE_INFO' ||
    s === 'PENDING_PAYMENT' ||
    s === 'SCHEDULED' ||
    s === 'ACTIVE' ||
    s === 'PAUSED'
  );
}
/** Renewing is offered once a promotion has finished its run. */
export function canRenew(s: CampaignState): boolean {
  return s === 'COMPLETED' || s === 'CANCELLED' || s === 'CANCELLED_EARLY';
}

// ─── Dates / windows ──────────────────────────────────────────────────────────
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add `days` to an ISO date (YYYY-MM-DD) → exclusive run length = `days`. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days - 1); // inclusive window: start + (days-1)
  return d.toISOString().slice(0, 10);
}

export function durationDays(startIso: string, endIso: string): number {
  const ms = +new Date(endIso) - +new Date(startIso);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Human countdown to an end date, e.g. "5 days left", "Ends today", "Ended". */
export function countdownLabel(endIso: string): string {
  const end = new Date((endIso.length <= 10 ? endIso + 'T23:59:59' : endIso));
  const diffMs = +end - Date.now();
  if (diffMs <= 0) return 'Ended';
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''} left`;
  const hours = Math.max(1, Math.round(diffMs / 3600000));
  return `${hours}h left`;
}

// ─── Session id (for de-duping placement events) ──────────────────────────────
let _sessionId: string | null = null;
export function sessionId(): string {
  if (!_sessionId) _sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return _sessionId;
}

// ─── Error mapping ────────────────────────────────────────────────────────────
export function toFeaturedError(err: unknown): FeaturedError {
  const e = err as {
    response?: { status?: number; data?: { error?: string; code?: string } };
    message?: string;
    status?: number;
    code?: string;
  };
  const status = e?.response?.status ?? e?.status;
  const code = e?.response?.data?.code ?? e?.code;
  const message = e?.response?.data?.error ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(message) as FeaturedError;
  out.status = status;
  out.code = code;
  return out;
}
