/**
 * D-001 regression: the free-vote "day bucket" must be computed in the CONTEST's
 * timezone, not UTC. The protected free-vote.service.ts uses getVoteDateUTC()
 * (new Date().toISOString().split('T')[0]) which rolls the day at 00:00 UTC —
 * wrong for e.g. Africa/Lagos (UTC+1), where a 00:30 local vote was being
 * bucketed into the previous calendar day.
 *
 * These assertions pin the timezone-correct, DST-correct day key that the
 * voting-bridge passes into the atomic claim RPC.
 */
import { describe, it, expect } from 'vitest';
import { resolveVoteDate, nextLocalMidnightIso } from '@/src/server/voting-bridge/vote-window';

describe('resolveVoteDate — timezone-correct day bucket (D-001)', () => {
  it('buckets a pre-UTC-midnight vote into the correct LOCAL day (Africa/Lagos, UTC+1)', () => {
    // 23:30 UTC on Jul 30 == 00:30 Jul 31 in Lagos → belongs to Jul 31.
    const instant = new Date('2026-07-30T23:30:00Z');
    expect(resolveVoteDate(instant, 'Africa/Lagos')).toBe('2026-07-31');
    // The buggy UTC bucket would have said 2026-07-30.
    expect(instant.toISOString().split('T')[0]).toBe('2026-07-30');
  });

  it('resets exactly at LOCAL midnight, not UTC midnight (Africa/Lagos)', () => {
    // 22:59 UTC == 23:59 local (still Jul 30)
    expect(resolveVoteDate(new Date('2026-07-30T22:59:00Z'), 'Africa/Lagos')).toBe('2026-07-30');
    // 23:00 UTC == 00:00 local (now Jul 31)
    expect(resolveVoteDate(new Date('2026-07-30T23:00:00Z'), 'Africa/Lagos')).toBe('2026-07-31');
  });

  it('is correct for a negative-offset zone across the local-midnight boundary (America/New_York)', () => {
    // 03:30 UTC == 22:30 previous day EST (UTC-5, standard time) → belongs to Jan 14.
    expect(resolveVoteDate(new Date('2026-01-15T03:30:00Z'), 'America/New_York')).toBe('2026-01-14');
  });

  it('handles DST wall-clock correctly (EC-002 — fall-back day in America/New_York)', () => {
    // 2026-11-01 is US DST "fall back". 04:30 UTC == 00:30 EDT (UTC-4) → Nov 1.
    expect(resolveVoteDate(new Date('2026-11-01T04:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    // 06:30 UTC == 01:30 (clocks fell back to EST/UTC-5) → still Nov 1.
    expect(resolveVoteDate(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01');
  });

  it('falls back to UTC for an empty/invalid timezone rather than throwing', () => {
    const instant = new Date('2026-07-30T23:30:00Z');
    expect(resolveVoteDate(instant, '')).toBe('2026-07-30');
    expect(resolveVoteDate(instant, 'Not/AZone')).toBe('2026-07-30');
  });
});

describe('nextLocalMidnightIso — reset boundary (FV-003)', () => {
  it('returns the next LOCAL midnight as an instant after now', () => {
    const now = new Date('2026-07-30T23:30:00Z'); // 00:30 Jul 31 in Lagos
    const reset = new Date(nextLocalMidnightIso(now, 'Africa/Lagos'));
    // Next local midnight is 00:00 Aug 1 Lagos == 23:00 UTC Jul 31.
    expect(reset.toISOString()).toBe('2026-07-31T23:00:00.000Z');
    expect(reset.getTime()).toBeGreaterThan(now.getTime());
  });
});
