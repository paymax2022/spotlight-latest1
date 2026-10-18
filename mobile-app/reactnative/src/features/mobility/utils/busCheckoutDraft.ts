// In-memory checkout draft for the multi-step bus v2 flow
// (search → results → seats ×N legs → passengers → review → pay).
//
// Route params can't carry this (arrays of legs/passengers, hold ids), and the
// flow is strictly linear with ONE booking in flight at a time, so a small
// module-level store with subscribe/notify is the least-bad option. Every
// setter replaces the draft object (never mutates in place) so
// useSyncExternalStore subscribers re-render.

import type {
  BusBookingQuote,
  BusBookingStatus,
  BusBookPassengerInput,
  BusLegDirection,
  BusV2SearchParams,
  Kobo,
} from '../types/busV2.types';
import { newIdempotencyKey } from './mobilityFormatters';

export interface BusDraftLegSummary {
  operatorName: string;
  routeLabel: string;
  vehicleClass: string;
  boardingAt: string | null;
  departureAt: string;
  fromStopName: string;
  toStopName: string;
  /** Per-seat server fare for the chosen segment, for display only. */
  fareKobo: Kobo;
}

export interface BusDraftLeg {
  direction: BusLegDirection;
  departureId: string;
  seatIds: string[];
  seatLabels: string[];
  fromSeq: number;
  toSeq: number;
  holdId: string;
  holdExpiresAt: string | null;
  summary: BusDraftLegSummary;
}

export interface BusCheckoutDraft {
  search: BusV2SearchParams;
  legs: BusDraftLeg[];
  passengers: BusBookPassengerInput[];
  /** One key per booking ATTEMPT-payload — regenerated whenever passengers or
   *  legs change, so an idempotent replay can never mint a stale booking. */
  bookIdemKey: string;
  bookingRef: string | null;
  bookingStatus: BusBookingStatus | null;
  quote: BusBookingQuote | null;
}

let draft: BusCheckoutDraft | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeBusDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current draft (stable reference — setters replace it wholesale). */
export function getBusDraft(): BusCheckoutDraft | null {
  return draft;
}

/** Begin a new checkout for a search. Drops any previous in-flight draft. */
export function startBusDraft(search: BusV2SearchParams): BusCheckoutDraft {
  draft = {
    search,
    legs: [],
    passengers: [],
    bookIdemKey: newIdempotencyKey('bus-book'),
    bookingRef: null,
    bookingStatus: null,
    quote: null,
  };
  emit();
  return draft;
}

/**
 * Attach (or replace) a held leg. Adding/changing a leg invalidates any booking
 * created from the previous shape — the review screen will re-book with a fresh
 * key set by setBusDraftPassengers or an explicit freshBusBookKey() call.
 */
export function upsertBusDraftLeg(leg: BusDraftLeg): void {
  if (!draft) return;
  const legs = draft.legs.filter((l) => l.direction !== leg.direction);
  legs.push(leg);
  draft = {
    ...draft,
    legs,
    bookingRef: null,
    bookingStatus: null,
    quote: null,
  };
  emit();
}

export function removeBusDraftLeg(direction: BusLegDirection): void {
  if (!draft) return;
  draft = {
    ...draft,
    legs: draft.legs.filter((l) => l.direction !== direction),
    bookingRef: null,
    bookingStatus: null,
    quote: null,
  };
  emit();
}

export function legForDirection(direction: BusLegDirection): BusDraftLeg | null {
  return draft?.legs.find((l) => l.direction === direction) ?? null;
}

/**
 * Store the passenger list. Any change here invalidates the booking: mint a new
 * idempotency key so a re-run of POST /book can't replay the previous payload.
 */
export function setBusDraftPassengers(passengers: BusBookPassengerInput[]): void {
  if (!draft) return;
  draft = {
    ...draft,
    passengers,
    bookIdemKey: newIdempotencyKey('bus-book'),
    bookingRef: null,
    bookingStatus: null,
    quote: null,
  };
  emit();
}

/** Record the booking created from this draft (status 'pending_payment'). */
export function setBusDraftBooking(
  bookingRef: string,
  status: BusBookingStatus,
  quote: BusBookingQuote | null,
): void {
  if (!draft) return;
  draft = { ...draft, bookingRef, bookingStatus: status, quote };
  emit();
}

export function clearBusDraft(): void {
  draft = null;
  emit();
}

/** Legs the chosen trip type still needs before checkout can proceed. */
export function missingLegs(d: BusCheckoutDraft | null): BusLegDirection[] {
  if (!d) return ['outbound'];
  const need: BusLegDirection[] = ['outbound'];
  if (d.search.tripType === 'return') need.push('return');
  return need.filter((dir) => !d.legs.some((l) => l.direction === dir));
}
