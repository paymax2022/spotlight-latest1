// Pure helpers for the PRD v2 bus flow (no React / RN imports — unit-testable).
// Seat availability is DERIVED from occupancy intervals: a seat is unavailable
// for a requested segment [fromSeq,toSeq) when any occupancy/hold overlaps it.
// All money stays integer kobo.

import type {
  BusBookingStatus,
  BusCancelPolicy,
  BusDepartureStop,
  BusOdFare,
  BusSeatCell,
  BusSeatOccupancy,
  BusSeatStatus,
  BusTicketStatus,
  BusV2ErrorCode,
  Kobo,
} from '../types/busV2.types';

/** Half-open interval overlap — mirrors the server's occupancy predicate. */
export function segmentsOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && aTo > bFrom;
}

/** Compute a seat cell's status for the requested [fromSeq,toSeq) segment. */
export function seatStatusForSegment(
  cell: BusSeatCell,
  occupancy: BusSeatOccupancy[],
  fromSeq: number,
  toSeq: number,
): Exclude<BusSeatStatus, 'selected'> {
  if (cell.blocked || cell.kind === 'empty' || cell.kind === 'driver') return 'blocked';
  for (const occ of occupancy) {
    if (occ.seatId !== cell.seatId) continue;
    if (segmentsOverlap(occ.fromSeq, occ.toSeq, fromSeq, toSeq)) {
      return occ.kind === 'held' ? 'held' : 'booked';
    }
  }
  return 'available';
}

/** Boardable stops, in seq order (every stop where passengers can get on). */
export function boardableStops(stops: BusDepartureStop[]): BusDepartureStop[] {
  return [...stops].filter((s) => s.canBoard).sort((a, b) => a.seq - b.seq);
}

/** Alightable stops strictly after fromSeq, in seq order. */
export function alightableStops(stops: BusDepartureStop[], fromSeq: number): BusDepartureStop[] {
  return [...stops]
    .filter((s) => s.canAlight && s.seq > fromSeq)
    .sort((a, b) => a.seq - b.seq);
}

/** Look up the per-seat fare for an OD segment in the departure's fare matrix. */
export function fareForSegment(odFares: BusOdFare[], fromSeq: number, toSeq: number): Kobo | null {
  const hit = odFares.find((f) => f.fromSeq === fromSeq && f.toSeq === toSeq);
  if (!hit || !Number.isSafeInteger(hit.fareKobo) || hit.fareKobo <= 0) return null;
  return hit.fareKobo;
}

/** Stops that render inside the booked segment (board → alight, inclusive). */
export function segmentStopNames(stops: BusDepartureStop[], fromSeq: number, toSeq: number): string[] {
  return [...stops]
    .filter((s) => s.seq >= fromSeq && s.seq <= toSeq)
    .sort((a, b) => a.seq - b.seq)
    .map((s) => s.name);
}

// ─── Status display ─────────────────────────────────────────────────────────

export const BUS_V2_BOOKING_STATUS_LABEL: Record<BusBookingStatus, string> = {
  pending_payment: 'Awaiting payment',
  issued: 'Ticket issued',
  partially_issued: 'Processing tickets',
  completed: 'Completed',
  cancel_requested: 'Cancellation requested',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Expired',
};

export const BUS_V2_TICKET_STATUS_LABEL: Record<BusTicketStatus, string> = {
  pending: 'Awaiting payment',
  issued: 'Issued',
  boarding: 'Boarding',
  boarded: 'On board',
  completed: 'Completed',
  cancel_requested: 'Cancellation requested',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Expired',
};

export function busV2StatusTone(status: BusBookingStatus | BusTicketStatus): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'pending':
    case 'pending_payment':
    case 'partially_issued':
    case 'cancel_requested':
      return 'warning';
    case 'cancelled':
    case 'refunded':
    case 'expired':
      return 'danger';
    default:
      return 'info';
  }
}

/** Linear trip-state track for the status-transition indicator. */
const TRIP_TRACK: BusTicketStatus[] = ['issued', 'boarding', 'boarded', 'completed'];

/**
 * Steps of the happy-path ticket transition for the progress indicator.
 * Terminal off-track states (cancelled/refunded/expired) return an empty list —
 * the badge conveys those instead.
 */
export function busTicketTrack(status: BusTicketStatus): { label: string; done: boolean; current: boolean }[] {
  const idx = TRIP_TRACK.indexOf(status);
  if (idx < 0) return [];
  return TRIP_TRACK.map((s, i) => ({
    label: BUS_V2_TICKET_STATUS_LABEL[s],
    done: i < idx || status === 'completed',
    current: i === idx,
  }));
}

/** QR is shown only while the ticket can still be scanned for boarding. */
export function isTicketScannable(status: BusTicketStatus): boolean {
  return status === 'issued' || status === 'boarding';
}

// ─── Cancel policy copy ─────────────────────────────────────────────────────

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

/** Copy for the cancel control — never promises money the policy didn't state. */
export function busV2CancelPolicyCopy(
  policy: BusCancelPolicy,
  fmt: (iso: string) => string = (iso) => iso,
): { label: string; hint: string | null; enabled: boolean } {
  if (!policy.cancellable) {
    const hint = policy.deadline
      ? `Cancellation closed (cut-off was ${fmt(policy.deadline)}).`
      : policy.cutoffMinutes != null
        ? `Cancellation closes ${policy.cutoffMinutes} min before departure.`
        : 'This booking can no longer be cancelled online.';
    return { label: 'Request cancellation', hint, enabled: false };
  }
  const bits: string[] = [];
  if (policy.deadline) bits.push(`until ${fmt(policy.deadline)}`);
  if (policy.refundPercent != null) bits.push(`${policy.refundPercent}% fare refund`);
  if (policy.feeKobo != null && policy.feeKobo > 0) bits.push(`${naira(policy.feeKobo)} cancellation fee`);
  const hint = `You can cancel${bits.length ? ` ${bits.join(' · ')}` : ''}. Refunds are confirmed after the request is processed.`;
  return { label: 'Request cancellation', hint, enabled: true };
}

// ─── Error parsing ──────────────────────────────────────────────────────────

const KNOWN_CODES: BusV2ErrorCode[] = [
  'SEAT_CONFLICT', 'HOLD_EXPIRED', 'HOLD_NOT_FOUND', 'FARE_UNAVAILABLE',
  'CANCEL_WINDOW_CLOSED', 'BOOKING_NOT_FOUND', 'PAYMENT_REQUIRED', 'INVALID_STATE',
];

/** Read the coded error the backend returned (httperr/CodedError shape). */
export function parseBusV2Error(err: unknown): { code: BusV2ErrorCode; message: string } {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> }; message?: string; code?: string };
  const d = e?.response?.data ?? {};
  const raw = [d.code, d.error_code, typeof d.error === 'string' ? d.error : undefined, e?.code]
    .find((c) => typeof c === 'string' && /^[A-Z_]+$/.test(c as string)) as string | undefined;
  const code = KNOWN_CODES.includes(raw as BusV2ErrorCode) ? (raw as BusV2ErrorCode) : 'UNKNOWN';
  const message =
    (typeof d.message === 'string' && d.message) ||
    (typeof d.error === 'string' && d.error !== raw && d.error) ||
    e?.message || 'Something went wrong. Please try again.';
  return { code, message };
}

/** True when the error means selected seats were lost to another customer. */
export function isSeatConflict(err: unknown): boolean {
  const e = err as { response?: { status?: number } };
  const { code } = parseBusV2Error(err);
  return code === 'SEAT_CONFLICT' || e?.response?.status === 409;
}

/** True when the error means the hold lapsed and seats must be re-held. */
export function isHoldExpired(err: unknown): boolean {
  const { code } = parseBusV2Error(err);
  return code === 'HOLD_EXPIRED' || code === 'HOLD_NOT_FOUND';
}

/** Error-state kind for departure-detail loads (mirrors busSeatMapErrKind). */
export function busDepartureErrKind(e: unknown): 'offline' | 'genericError' {
  const x = e as { response?: unknown; message?: string };
  if (x?.response) return 'genericError';
  return typeof x?.message === 'string' && x.message.includes('unavailable') ? 'genericError' : 'offline';
}

/** Countdown text for an active hold; null when nothing is held / expiry unknown. */
export function holdCountdownCopy(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'Hold expired — reselect your seats';
  const mins = Math.ceil(ms / 60_000);
  return `Seats held for ${mins} min — finish booking before the hold lapses`;
}

// ─── Passenger validation ───────────────────────────────────────────────────

export function passengerInputOk(p: { name: string; phone: string }): boolean {
  return p.name.trim().length > 1 && p.phone.replace(/\D/g, '').length >= 7;
}
