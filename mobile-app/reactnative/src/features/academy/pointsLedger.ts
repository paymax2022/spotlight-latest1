// ── Spotlight Academy — reward-points ledger (pure, idempotent) ──────────────
// Reward points are non-monetary, but earn/redeem follows money-path discipline:
// an append-only ledger + idempotent awards so a replayed exam submit or a
// re-played challenge can't farm points. This module is pure (no I/O, no module
// state) so it is unit-testable; the mock/live API layer wraps it with the
// module-scoped balance/history and the offline queue.

import type { RewardBalance, RewardLedgerEntry } from './types';

export interface PointsLedgerState {
  balance: RewardBalance;
  history: RewardLedgerEntry[];
  /** Idempotency keys already credited (e.g. `exam:<attemptId>`). */
  awarded: ReadonlySet<string>;
}

export interface PointsAward {
  points: number;
  reason: string;
  /** Stable ledger-entry id (caller supplies; keeps the fn deterministic). */
  id: string;
  /** ISO timestamp (caller supplies; keeps the fn deterministic/testable). */
  ts: string;
  /**
   * Optional idempotency key. When present, an award with a key already in
   * `state.awarded` is a no-op (applied=false) — this is what stops the same
   * exam attempt / challenge from re-awarding on replay. Keyless awards always
   * apply (backward-compatible with genuinely-repeatable earns).
   */
  key?: string;
}

/** Seed a ledger state from an existing balance (empty history + awarded set). */
export function emptyLedger(balance: RewardBalance): PointsLedgerState {
  return { balance, history: [], awarded: new Set<string>() };
}

/**
 * Apply a points award. Pure: returns a NEW state and never mutates the input.
 * `applied` is false when the award is a non-positive amount or a duplicate of
 * an already-credited idempotency key.
 */
export function creditPoints(
  state: PointsLedgerState,
  award: PointsAward,
): { state: PointsLedgerState; applied: boolean } {
  if (!(award.points > 0)) return { state, applied: false };
  if (award.key && state.awarded.has(award.key)) return { state, applied: false };

  const balance: RewardBalance = {
    ...state.balance,
    points: state.balance.points + award.points,
    pendingPoints: state.balance.pendingPoints + award.points,
    lifetimeEarned: state.balance.lifetimeEarned + award.points,
  };
  const entry: RewardLedgerEntry = {
    id: award.id,
    ts: award.ts,
    kind: 'earn',
    reason: award.reason,
    points: award.points,
    synced: false,
  };
  const awarded = award.key
    ? new Set<string>(state.awarded).add(award.key)
    : state.awarded;

  return {
    state: { balance, history: [entry, ...state.history], awarded },
    applied: true,
  };
}
