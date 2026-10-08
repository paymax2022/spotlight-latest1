// Pure helpers for the bus booking flow (no React / RN imports so they can be
// unit-tested with `node --experimental-strip-types --test`). All money is
// integer kobo.

export type BusPhase =
  | 'booked' | 'issued' | 'boarding' | 'boarded' | 'completed'
  | 'rescheduled' | 'cancelled' | 'cancelled_pending_refund' | 'refunded';

export type BusRefundStatus = 'none' | 'pending' | 'refunded' | 'failed' | 'manual_required';

/** Seat labels are strings in the UI; the backend wants an integer >= 1. */
export function parseSeatNumber(seat: unknown): number {
  const s = typeof seat === 'number' ? String(seat) : typeof seat === 'string' ? seat.trim() : '';
  if (!/^\d+$/.test(s)) throw new Error(`Invalid seat number: ${String(seat)}`);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid seat number: ${String(seat)}`);
  return n;
}

/** A usable fare is a positive integer count of kobo. Anything else is unusable. */
export function isValidFareKobo(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** Throws when the seat-map payload carries no usable fare (never fall back to 0). */
export function requireFareKobo(v: unknown): number {
  if (!isValidFareKobo(v)) throw new Error('Fare unavailable for this trip. Please try again.');
  return v;
}

export function derivePhase(status?: string | null, boardingStatus?: string | null, refundStatus?: string | null): BusPhase {
  const refund = refundStatus ?? 'none';
  if (status === 'refunded' || (status === 'cancelled' && refund === 'refunded')) return 'refunded';
  if (status === 'cancelled') {
    if (refund === 'pending' || refund === 'failed' || refund === 'manual_required') return 'cancelled_pending_refund';
    return 'cancelled';
  }
  if (status === 'completed') return 'completed';
  if (status === 'boarded' || boardingStatus === 'boarded') return 'boarded';
  if (status === 'boarding') return 'boarding';
  if (status === 'booked') return 'booked';
  return 'issued';
}

export interface NormalizedBusTicket {
  id: string;
  scheduleId: string;
  phase: BusPhase;
  routeLabel: string;
  originTerminal: string;
  destTerminal: string;
  operatorName: string;
  departAt: string;
  arriveAt: string;
  seatNumber: string;
  passengerName: string;
  fareKobo: number;
  currency: 'NGN';
  qrCode: string | null;
  paymentStatus: 'settled' | 'refunded' | 'failed';
  createdAt: string;
  refundStatus: BusRefundStatus;
  cancelDeadline: string | null;
  cancelCutoffMinutes: number | null;
  cancellable: boolean;
}

const REFUND: BusRefundStatus[] = ['none', 'pending', 'refunded', 'failed', 'manual_required'];

/** Maps the backend ticket payload (camelCase) onto the UI ticket. Tolerates snake_case. */
export function normalizeBusTicket(rawIn: unknown): NormalizedBusTicket {
  const r = (rawIn ?? {}) as Record<string, unknown>;
  const pick = (camel: string, snake: string) => r[camel] ?? r[snake];
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
  const rs = pick('refundStatus', 'refund_status');
  const refundStatus: BusRefundStatus = REFUND.includes(rs as BusRefundStatus) ? (rs as BusRefundStatus) : 'none';
  const status = str(pick('status', 'status'), '') || null;
  const boarding = str(pick('boardingStatus', 'boarding_status'), '') || null;
  const phase = derivePhase(status, boarding, refundStatus);
  const pay = str(pick('paymentStatus', 'payment_status'));
  const fare = pick('fareKobo', 'fare_kobo');
  const deadline = pick('cancelDeadline', 'cancel_deadline');
  const cutoff = pick('cancelCutoffMinutes', 'cancel_cutoff_minutes');
  const voided = phase === 'cancelled' || phase === 'cancelled_pending_refund' || phase === 'refunded';
  const qr = pick('qrCode', 'qr_code');
  return {
    id: str(r.id),
    scheduleId: str(pick('scheduleId', 'schedule_id')),
    phase,
    routeLabel: str(pick('routeLabel', 'route_label'), 'Bus ticket'),
    originTerminal: str(pick('originTerminal', 'origin_terminal')),
    destTerminal: str(pick('destTerminal', 'dest_terminal')),
    operatorName: str(pick('operatorName', 'operator_name')),
    departAt: str(pick('departureTime', 'departure_time') ?? pick('departAt', 'depart_at')),
    arriveAt: str(pick('arriveAt', 'arrive_at')),
    seatNumber: str(pick('seatNumber', 'seat_number')),
    passengerName: str(pick('passengerName', 'passenger_name')),
    fareKobo: typeof fare === 'number' && Number.isFinite(fare) ? Math.trunc(fare) : 0,
    currency: 'NGN',
    qrCode: voided || typeof qr !== 'string' || !qr ? null : qr,
    paymentStatus: pay === 'refunded' || phase === 'refunded' ? 'refunded' : pay === 'failed' ? 'failed' : 'settled',
    createdAt: str(pick('createdAt', 'created_at')),
    refundStatus,
    cancelDeadline: typeof deadline === 'string' && deadline ? deadline : null,
    cancelCutoffMinutes: typeof cutoff === 'number' ? cutoff : null,
    cancellable: r.cancellable === true,
  };
}

export interface CancelResult {
  refundStatus: BusRefundStatus;
  refundedKobo: number;
  message: string;
}

/** Maps the 200/202 cancel body. An unknown/absent refund_status is never treated as refunded. */
export function toCancelResult(bodyIn: unknown): CancelResult {
  const b = (bodyIn ?? {}) as Record<string, unknown>;
  const rs = b.refund_status ?? b.refundStatus;
  const refundStatus: BusRefundStatus = REFUND.includes(rs as BusRefundStatus) ? (rs as BusRefundStatus) : 'pending';
  const rk = b.refunded_kobo ?? b.refundedKobo;
  return {
    refundStatus,
    refundedKobo: refundStatus === 'refunded' && typeof rk === 'number' ? Math.trunc(rk) : 0,
    message: typeof b.message === 'string' ? b.message : '',
  };
}

export type BusCancelErrorCode = 'CANCEL_WINDOW_CLOSED' | 'REFUND_REQUIRES_SUPPORT' | 'INVALID_STATE' | 'UNKNOWN';

/** Reads the backend error code + message from an axios-style error. */
export function parseCancelError(err: unknown): { code: BusCancelErrorCode; message: string } {
  const e = err as { response?: { data?: Record<string, unknown> }; message?: string; code?: string };
  const d = e?.response?.data ?? {};
  const rawCode = [d.code, d.error_code, typeof d.error === 'string' ? d.error : undefined, e?.code]
    .find((c) => typeof c === 'string' && /^[A-Z_]+$/.test(c as string)) as string | undefined;
  const code: BusCancelErrorCode =
    rawCode === 'CANCEL_WINDOW_CLOSED' || rawCode === 'REFUND_REQUIRES_SUPPORT' || rawCode === 'INVALID_STATE'
      ? rawCode : 'UNKNOWN';
  const message =
    (typeof d.message === 'string' && d.message) ||
    (typeof d.error === 'string' && d.error !== rawCode && d.error) ||
    e?.message || 'Could not cancel this ticket.';
  return { code, message };
}

const naira = (kobo: number) =>
  `₦${(Math.round(kobo / 100)).toLocaleString('en-NG')}`;

/** Human copy shown after a cancel call. Says "returned" ONLY for refund_status 'refunded'. */
export function cancelResultCopy(r: CancelResult): { tone: 'success' | 'warning'; text: string } {
  switch (r.refundStatus) {
    case 'refunded':
      return { tone: 'success', text: `${naira(r.refundedKobo)} has been returned to your wallet.` };
    case 'manual_required':
      return { tone: 'warning', text: 'Ticket cancelled. Your refund needs manual review — please contact support.' };
    case 'pending':
    case 'failed':
      return { tone: 'warning', text: 'Ticket cancelled. Your refund is being processed — it has not been returned yet.' };
    default:
      return { tone: 'warning', text: 'Ticket cancelled. No refund has been issued — please contact support if you expected one.' };
  }
}

export function cancelErrorCopy(code: BusCancelErrorCode, message: string): string {
  if (code === 'REFUND_REQUIRES_SUPPORT') return 'This fare has already been paid out to the operator. Please contact support to request a refund.';
  if (code === 'CANCEL_WINDOW_CLOSED') return message || 'The cancellation window for this trip has closed.';
  if (code === 'INVALID_STATE') return message || 'This ticket can no longer be cancelled.';
  return message || 'Could not cancel this ticket. Please try again.';
}

/** Copy for the cancel control. Never promises money back; reflects the server verdict. */
export function cancelPolicyCopy(
  t: { cancellable: boolean; cancelDeadline: string | null; cancelCutoffMinutes: number | null },
  fmt: (iso: string) => string = (iso) => iso,
): { label: string; hint: string | null; enabled: boolean } {
  if (!t.cancellable) {
    const hint = t.cancelDeadline
      ? `Cancellation closed (cut-off was ${fmt(t.cancelDeadline)}).`
      : t.cancelCutoffMinutes != null
        ? `Cancellation closes ${t.cancelCutoffMinutes} min before departure.`
        : 'This ticket can no longer be cancelled online.';
    return { label: 'Cancel ticket', hint, enabled: false };
  }
  const hint = t.cancelDeadline
    ? `You can cancel until ${fmt(t.cancelDeadline)}. Refund is confirmed after you cancel.`
    : 'Refund is confirmed after you cancel.';
  return { label: 'Cancel ticket', hint, enabled: true };
}

/** Edge-state kind for seat-map errors: a rejected fare is a backend data problem, not "offline". */
export function busSeatMapErrKind(e: unknown): 'offline' | 'genericError' {
  const x = e as { response?: unknown; message?: string };
  if (x?.response) return 'genericError';
  return typeof x?.message === 'string' && x.message.startsWith('Fare unavailable') ? 'genericError' : 'offline';
}

/** True when a seat label from route params can be sent as the integer seat_number. */
export function isBookableSeat(seat: unknown): boolean {
  try { parseSeatNumber(seat); return true; } catch { return false; }
}

export function busPhaseTone(phase: BusPhase): 'success' | 'warning' | 'danger' | 'info' {
  if (phase === 'completed') return 'success';
  if (phase === 'cancelled_pending_refund') return 'warning';
  if (phase === 'cancelled' || phase === 'refunded') return 'danger';
  return 'info';
}

/** True while the ticket can still be used to travel (not cancelled/refunded). */
export function isTicketActive(phase: BusPhase): boolean {
  return phase !== 'cancelled' && phase !== 'cancelled_pending_refund' && phase !== 'refunded';
}
