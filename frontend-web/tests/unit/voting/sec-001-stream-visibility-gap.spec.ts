/**
 * SEC-001 / VV-003 follow-up finding from the TS-10 IDOR/leak sweep.
 *
 * GET /api/votes/stream (SSE) reads `vote_totals` directly and streams
 * `total_confirmed_votes`, `free_votes`, `paid_votes`, `rank` to ANY caller
 * with no auth and — unlike /api/leaderboard/[contestId] (fixed under D-005)
 * — with NO call to `getEffectiveVisibility()` at all. A contest with
 * `showPublicVoteCount: false` / a hidden phase still leaks live counts and
 * rank over this endpoint every 5 seconds for as long as the client keeps
 * the EventSource open.
 *
 * frontend-web/app/api/votes/stream/route.ts IS in the protect-legacy.sh
 * blocked list (hook-protected) and — unlike milestone.service.ts — the
 * entire query + streaming logic lives inline in this one route.ts file with
 * no exported function to import and wrap from an adapter. There is no seam
 * to bridge through: fixing this requires either (a) editing this file
 * directly (blocked), or (b) standing up a new gated endpoint AND migrating
 * every client off the old one (out of Batch 1 scope — touches the same
 * contract other in-flight agents are working against). Deferred to the
 * bridge track; logged as D-008 below.
 *
 * This test PINS the current (leaking) behavior against the real Supabase
 * query shape the route issues, so the moment a fix ships (old route
 * deprecated, or a visibility gate added) this test's premise — "no
 * visibility check happens before the query runs" — must be revisited.
 * It is intentionally a documentation/regression pin, not a "this is
 * correct" assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('SEC-001/VV-003: /api/votes/stream visibility gap (documented, deferred — D-008)', () => {
  it('the route source contains no call to getEffectiveVisibility (confirms the gap is still open)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../app/api/votes/stream/route.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/getEffectiveVisibility/);
    // It DOES query vote_totals directly with no visibility-derived redaction —
    // this is the leak surface. If this assertion ever fails because the route
    // now imports getEffectiveVisibility, D-008 should be marked Fixed instead
    // of Deferred and this test rewritten as a positive assertion (see
    // leaderboard-visibility.spec.ts for the pattern to follow).
    expect(source).toMatch(/from\(['"]vote_totals['"]\)/);
    expect(source).toMatch(/total_confirmed_votes/);
  });
});
