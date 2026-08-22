// ── Telemedicine — booking price mapping (ADR-040) ───────────────────────────
//
// The platform booking fee is computed by the Go backend. This module's whole job
// is to carry the server's numbers to the screens WITHOUT the app ever deriving a
// price of its own — that derivation is what let the confirm screen display one
// total while the backend escrowed another, and let the card rail collect a fee
// that had no ledger entry behind it.
//
// The Go backend speaks snake_case. Only MONEY fields are mapped here; the rest of
// this module's live field mapping is a known, pre-existing gap.

import type { Appointment, BookingQuote, Doctor } from '@/types/telemedicine';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Read the server's booking quote off a doctor payload.
 *
 * Returns `undefined` when the server sent no quote, or sent one that prices
 * nothing (a zero/absent total — the backend's `Priceable()` false case). Callers
 * MUST fail closed on `undefined`: neither guessing the fee nor falling back to
 * the consultation fee alone is acceptable, since both re-create the
 * display-vs-charge divergence this mapping exists to prevent.
 */
export function readBookingQuote(raw: Record<string, unknown> | undefined): BookingQuote | undefined {
  const q = raw?.booking as Record<string, unknown> | undefined;
  if (!q) return undefined;
  const totalKobo = num(q.total_kobo ?? q.totalKobo);
  if (totalKobo <= 0) return undefined;
  return {
    consultFeeKobo:  num(q.consult_fee_kobo  ?? q.consultFeeKobo),
    platformFeeBp:   num(q.platform_fee_bp   ?? q.platformFeeBp),
    platformFeeKobo: num(q.platform_fee_kobo ?? q.platformFeeKobo),
    totalKobo,
  };
}

/** Map a doctor payload's money fields (server `consult_fee_kobo` + `booking`). */
export function mapDoctorMoney(raw: unknown): Doctor {
  const r = (raw ?? {}) as Record<string, unknown>;
  const booking = readBookingQuote(r);
  return {
    ...(r as unknown as Doctor),
    feeKobo: num(r.consult_fee_kobo ?? r.feeKobo ?? booking?.consultFeeKobo),
    booking,
  };
}

/** Map an appointment payload's money fields (fee / platform fee / total). */
export function mapAppointmentMoney(raw: unknown): Appointment {
  const r = (raw ?? {}) as Record<string, unknown>;
  const feeKobo = num(r.fee_kobo ?? r.feeKobo);
  const platformFeeKobo = num(r.platform_fee_kobo ?? r.platformFeeKobo);
  return {
    ...(r as unknown as Appointment),
    feeKobo,
    platformFeeKobo,
    // Bookings made before ADR-040 escrowed the consultation fee alone, so a
    // missing total IS the consultation fee — never 0, which would read on the
    // appointment screen as "this patient paid nothing".
    totalKobo: num(r.total_kobo ?? r.totalKobo) || feeKobo + platformFeeKobo,
  };
}

/**
 * Mock mode has no server to quote the booking, so the demo fixtures stand in for
 * one. The rate lives HERE, in the fake-server layer — never in a screen — so the
 * checkout still only ever renders a quote it was handed. Keep in step with
 * `telemedicine.PlatformFeeBp` in the Go backend, which floors the same way.
 */
export const DEMO_PLATFORM_FEE_BP = 500;

export function withDemoQuote(d: Doctor): Doctor {
  const platformFeeKobo = Math.floor((d.feeKobo * DEMO_PLATFORM_FEE_BP) / 10_000);
  return {
    ...d,
    booking: {
      consultFeeKobo:  d.feeKobo,
      platformFeeBp:   DEMO_PLATFORM_FEE_BP,
      platformFeeKobo,
      totalKobo:       d.feeKobo + platformFeeKobo,
    },
  };
}

/**
 * Build the `scheduled_at` timestamp the backend requires from the slot the
 * patient picked ("2026-08-20" + "09:00 AM"). Returns undefined when either part
 * is missing or unparseable, so the server rejects the booking rather than the
 * client inventing an appointment time.
 */
export function slotToISO(slotDate?: string, slotTime?: string): string | undefined {
  if (!slotDate || !slotTime) return undefined;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(slotTime.trim());
  if (!m) return undefined;
  const [, hh, mm, meridiem] = m;
  const hours = Number(hh);
  const minutes = Number(mm);
  if (hours < 1 || hours > 12 || minutes > 59) return undefined;
  let hour = hours % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;
  const d = new Date(`${slotDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(hour, minutes, 0, 0);
  return d.toISOString();
}
