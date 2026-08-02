// Pure-logic unit tests for the Academy reward-points ledger (points-path).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs \
//        --test "src/features/academy/__tests__/*.test.ts"
//
// Reward points are non-monetary but earn/redeem is treated with money-path
// discipline (append-only ledger, idempotent awards). The bug this pins: points
// were credited with NO dedup key, so re-submitting the same exam attempt (or
// replaying a challenge) re-awarded points every time — farmable. An award
// carrying an idempotency `key` must apply exactly once.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { creditPoints, emptyLedger } from '../pointsLedger.ts';
import type { PointsLedgerState } from '../pointsLedger.ts';

const base: PointsLedgerState = emptyLedger({ points: 100, pendingPoints: 0, lifetimeEarned: 100 });

test('credits positive points and appends one earn entry', () => {
  const { state, applied } = creditPoints(base, { points: 300, reason: 'Mock exam completed', id: 'rl_1', ts: 't1' });
  assert.equal(applied, true);
  assert.equal(state.balance.points, 400);
  assert.equal(state.balance.pendingPoints, 300);
  assert.equal(state.balance.lifetimeEarned, 400);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].kind, 'earn');
  assert.equal(state.history[0].points, 300);
  assert.equal(state.history[0].reason, 'Mock exam completed');
});

test('IDEMPOTENT: the same key credits exactly once (no double-award on replay)', () => {
  const first = creditPoints(base, { points: 300, reason: 'Mock exam completed', key: 'exam:att_1', id: 'rl_1', ts: 't1' });
  assert.equal(first.applied, true);
  assert.equal(first.state.balance.points, 400);
  // Re-submit the SAME attempt → same key → must be a no-op.
  const second = creditPoints(first.state, { points: 300, reason: 'Mock exam completed', key: 'exam:att_1', id: 'rl_2', ts: 't2' });
  assert.equal(second.applied, false, 'second award with the same key must not apply');
  assert.equal(second.state.balance.points, 400, 'balance unchanged on replay');
  assert.equal(second.state.history.length, 1, 'no second ledger entry');
});

test('different keys both apply (distinct attempts each earn)', () => {
  const a = creditPoints(base, { points: 300, reason: 'exam', key: 'exam:att_1', id: 'rl_1', ts: 't1' });
  const b = creditPoints(a.state, { points: 300, reason: 'exam', key: 'exam:att_2', id: 'rl_2', ts: 't2' });
  assert.equal(b.applied, true);
  assert.equal(b.state.balance.points, 700);
  assert.equal(b.state.history.length, 2);
});

test('keyless awards always apply (backward-compatible for un-keyed earns)', () => {
  const a = creditPoints(base, { points: 10, reason: 'x', id: 'rl_1', ts: 't1' });
  const b = creditPoints(a.state, { points: 10, reason: 'x', id: 'rl_2', ts: 't2' });
  assert.equal(a.applied && b.applied, true);
  assert.equal(b.state.balance.points, 120);
});

test('non-positive points never apply and never write a ledger entry', () => {
  assert.equal(creditPoints(base, { points: 0, reason: 'x', id: 'r', ts: 't' }).applied, false);
  const neg = creditPoints(base, { points: -50, reason: 'x', id: 'r', ts: 't' });
  assert.equal(neg.applied, false);
  assert.equal(neg.state.history.length, 0);
});

test('purity: the input state is not mutated', () => {
  const snapshotPoints = base.balance.points;
  const snapshotLen = base.history.length;
  creditPoints(base, { points: 300, reason: 'exam', key: 'exam:att_9', id: 'rl_9', ts: 't9' });
  assert.equal(base.balance.points, snapshotPoints, 'balance not mutated');
  assert.equal(base.history.length, snapshotLen, 'history not mutated');
  assert.equal(base.awarded.has('exam:att_9'), false, 'awarded set not mutated');
});
