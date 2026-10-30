// Pure helpers for the operator side of bus boarding: QR validate
// (POST /driver/bus/validate) and departure cancel
// (POST /mobility/bus/provider/schedules/:id/cancel). Kept framework-free so
// they run under node:test.

/** Outcome kinds for a boarding scan. Only 'boarded' admits the passenger. */
export type BoardingOutcome =
  | 'boarded'
  | 'already_boarded'
  | 'not_open'
  | 'closed'
  | 'trip_cancelled'
  | 'invalid'
  | 'not_operator'
  | 'not_found'
  | 'offline'
  | 'unknown';

export interface BoardingVerdict {
  outcome: BoardingOutcome;
  ok: boolean;
  title: string;
  message: string;
}

const COPY: Record<BoardingOutcome, { title: string; message: string }> = {
  boarded:         { title: 'Passenger boarded', message: 'Ticket validated. Let the passenger board.' },
  already_boarded: { title: 'Already boarded',   message: 'This ticket was already used to board. Do not admit again.' },
  not_open:        { title: 'Boarding not open', message: 'Boarding has not opened for this trip yet.' },
  closed:          { title: 'Boarding closed',   message: 'Boarding is closed for this trip.' },
  trip_cancelled:  { title: 'Trip cancelled',    message: 'This departure was cancelled. The ticket is not valid.' },
  invalid:         { title: 'Ticket not valid',  message: 'This ticket was cancelled, refunded or is otherwise not valid.' },
  not_operator:    { title: 'Not your trip',     message: 'This ticket is for a route you do not operate.' },
  not_found:       { title: 'Unknown ticket',    message: 'No ticket matches this code.' },
  offline:         { title: 'No connection',     message: 'Could not reach the server. Nothing was validated — try again.' },
  unknown:         { title: 'Could not validate', message: 'Something went wrong. Nothing was validated — try again.' },
};

export function boardingVerdict(outcome: BoardingOutcome, serverMessage?: string): BoardingVerdict {
  const c = COPY[outcome];
  // Server copy is preferred for the generic buckets where it is more specific.
  const message = (outcome === 'unknown' || outcome === 'invalid') && serverMessage ? serverMessage : c.message;
  return { outcome, ok: outcome === 'boarded', title: c.title, message };
}

/**
 * Maps a validate failure onto an outcome. The Go handler returns every
 * conflict as 409 INVALID_STATE, so the 409 bucket is split on the message
 * (backend/internal/transport/bus.go ValidateBusTicket).
 */
export function classifyValidateError(err: unknown): BoardingVerdict {
  const e = err as { response?: { status?: number; data?: { error?: unknown; message?: unknown } } };
  if (!e?.response) return boardingVerdict('offline');
  const status = e.response.status;
  const raw = e.response.data?.error ?? e.response.data?.message;
  const msg = typeof raw === 'string' ? raw : '';
  const m = msg.toLowerCase();
  if (status === 403) return boardingVerdict('not_operator');
  if (status === 404) return boardingVerdict('not_found');
  if (status === 409) {
    if (m.includes('already boarded')) return boardingVerdict('already_boarded');
    if (m.includes('not opened')) return boardingVerdict('not_open');
    if (m.includes('closed')) return boardingVerdict('closed');
    if (m.includes('cancelled')) return boardingVerdict('trip_cancelled');
    return boardingVerdict('invalid', msg || undefined);
  }
  return boardingVerdict('unknown', msg || undefined);
}

/** Trims scanner noise; a bus ticket QR is the bare server-issued code. */
export function normalizeQrPayload(raw: string): string | null {
  const v = (raw ?? '').trim();
  if (!v || v.length > 200 || /\s/.test(v)) return null;
  return v;
}

/** Wire shape of BusScheduleCancelResult (snake_case from Go). */
export interface ScheduleCancelResult {
  scheduleId: string;
  status: string;
  ticketsTotal: number;
  refunded: number;
  pending: number;
  failed: number;
  manualRequired: number;
  complete: boolean;
}

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);

export function toScheduleCancelResult(raw: Record<string, unknown> | null | undefined, scheduleId: string): ScheduleCancelResult {
  const r = raw ?? {};
  return {
    scheduleId: typeof r.schedule_id === 'string' ? r.schedule_id : scheduleId,
    status: typeof r.status === 'string' ? r.status : 'unknown',
    ticketsTotal: int(r.tickets_total),
    refunded: int(r.refunded),
    pending: int(r.pending),
    failed: int(r.failed),
    manualRequired: int(r.manual_required),
    complete: r.complete === true,
  };
}

/** Operator-facing summary. Never says "refunded" for tickets whose money has not moved. */
export function scheduleCancelCopy(r: ScheduleCancelResult): { tone: 'success' | 'warning'; text: string } {
  if (r.ticketsTotal === 0) return { tone: 'success', text: 'Departure cancelled. No passengers had booked.' };
  const parts = [`${r.refunded} of ${r.ticketsTotal} passenger${r.ticketsTotal === 1 ? '' : 's'} refunded to wallet`];
  const open = r.pending + r.failed;
  if (open > 0) parts.push(`${open} refund${open === 1 ? '' : 's'} still processing`);
  if (r.manualRequired > 0) parts.push(`${r.manualRequired} need${r.manualRequired === 1 ? 's' : ''} a manual refund by support`);
  return { tone: r.complete && open === 0 && r.manualRequired === 0 ? 'success' : 'warning', text: `Departure cancelled. ${parts.join(' · ')}.` };
}
