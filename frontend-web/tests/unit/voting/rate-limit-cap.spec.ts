/**
 * AUD-PERF-002 — the voting token-bucket limiter had only a 5-minute interval
 * prune; a caller rotating keys could grow the Map unboundedly inside a
 * window. These pin the hard cap: new keys past the cap are denied
 * (fail-closed for the untrackable key only — existing buckets are never
 * evicted), and a full map of stale buckets frees slots via inline sweep.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';

const CAP = 10_000;

describe('checkRateLimit key-cap (AUD-PERF-002)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('denies a NEW key once the map is full, but keeps serving tracked keys', () => {
    for (let i = 0; i < CAP; i++) {
      checkRateLimit(`flood-${i}`, 5, 60_000);
    }
    expect(checkRateLimit('new-key', 5, 60_000).allowed).toBe(false);
    // A tracked key still has its budget — the cap never evicts live entries.
    expect(checkRateLimit('flood-0', 5, 60_000).allowed).toBe(true);
  });

  it('frees slots for new keys once buckets go stale', () => {
    for (let i = 0; i < CAP; i++) {
      checkRateLimit(`flood-${i}`, 5, 60_000);
    }
    // Past the 5-minute staleness cutoff — the inline sweep on a capped insert
    // must reclaim them instead of denying forever.
    vi.setSystemTime(1_700_000_000_000 + 6 * 60_000);
    expect(checkRateLimit('new-key', 5, 60_000).allowed).toBe(true);
  });
});
