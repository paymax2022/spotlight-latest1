// Pins the client vote gate to the server's rule in
// backend/internal/connect/voting/service.go (`votingOpen`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVotingWindow, isVotingOpen } from '@/features/voting/utils/votingWindow';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const at = (iso: string) => Date.parse(iso);

const contest = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1', title: 'T', category: 'Music', status: 'LIVE',
    contestantCount: 0, totalVotes: 0, freeVotesPerDay: 1, paidVotingEnabled: true,
    ...over,
  }) as never;

test('open when live and inside the window', () => {
  assert.equal(isVotingOpen(contest({ startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-07-01T00:00:00Z' }), NOW), true);
});

test('CLOSED once the deadline has passed — even while status still says LIVE', () => {
  // The case that shipped: nothing flips contests.status to 'ended' on expiry, so
  // an over contest reported LIVE and the vote buttons stayed active.
  const w = getVotingWindow(contest({ status: 'LIVE', endsAt: '2026-06-14T23:59:59Z' }), NOW);
  assert.equal(w.open, false);
  assert.equal(w.reason, 'ended');
  assert.match(w.message ?? '', /closed/i);
});

test('closed before it opens', () => {
  const w = getVotingWindow(contest({ startsAt: '2026-06-20T00:00:00Z' }), NOW);
  assert.equal(w.open, false);
  assert.equal(w.reason, 'not_started');
});

test('closed when the status is not live, even inside the window', () => {
  const w = getVotingWindow(contest({ status: 'CLOSED', endsAt: '2026-07-01T00:00:00Z' }), NOW);
  assert.equal(w.open, false);
  assert.equal(w.reason, 'not_live');
});

test('the deadline outranks the status', () => {
  // Both are wrong for voting; "ended" is the accurate thing to tell the user.
  assert.equal(getVotingWindow(contest({ status: 'PAUSED', endsAt: '2026-01-01T00:00:00Z' }), NOW).reason, 'ended');
});

test('missing dates fall back to the status alone', () => {
  assert.equal(isVotingOpen(contest({ status: 'LIVE' }), NOW), true);
  assert.equal(isVotingOpen(contest({ status: 'CLOSED' }), NOW), false);
});

test('an unloaded contest is treated as open so a pending query does not flash closed', () => {
  assert.equal(isVotingOpen(undefined, NOW), true);
  assert.equal(isVotingOpen(null, NOW), true);
});

test('an exact boundary is still open (server uses after/before, not inclusive-exclusive)', () => {
  assert.equal(isVotingOpen(contest({ endsAt: '2026-06-15T12:00:00Z' }), at('2026-06-15T12:00:00Z')), true);
});

test('unparseable dates are ignored rather than closing voting', () => {
  assert.equal(isVotingOpen(contest({ endsAt: 'not-a-date' }), NOW), true);
});
