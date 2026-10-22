// The mock parcel's state machine (mock builds only). It returns a NEW object
// whenever the parcel moves: mutating the cached parcel in place made it
// deep-equal to react-query's (same, already-mutated) data, so the tracking
// screen never re-rendered. Pure, type-only imports, so it runs under node --test.

import type { Courier, Parcel } from '../types/modes.types';

const TERMINAL = ['delivered', 'cancelled', 'failed'];

export function advanceParcelPhase(p: Parcel, nowMs: number, courier: Courier): Parcel {
  if (TERMINAL.includes(p.phase)) return p;
  const ageMs = nowMs - new Date(p.createdAt).getTime();
  const next: Parcel = { ...p };
  if (next.phase === 'created' && ageMs > 6_000) {
    next.phase = 'courier_assigned';
    next.courier = courier;
    // Courier accept is when the insurer binds the prepaid cover (ADR-PR836).
    if (next.insuranceStatus === 'held') next.insuranceStatus = 'bound';
  }
  if (next.phase === 'courier_assigned' && ageMs > 14_000) next.phase = 'pickup_pin_verified';
  if (next.phase === 'pickup_pin_verified' && ageMs > 20_000) next.phase = 'picked_up';
  if (next.phase === 'picked_up' && ageMs > 26_000) next.phase = 'in_transit';
  if (next.phase === 'in_transit' && ageMs > 40_000) {
    next.phase = 'delivered';
    next.paymentStatus = 'settled';
    next.proofUrl = 'mock://proof/live';
    next.deliveredAt = new Date(nowMs).toISOString();
    next.pickupPin = null;
    next.dropoffPin = null;
  }
  return next.phase === p.phase ? p : next;
}
