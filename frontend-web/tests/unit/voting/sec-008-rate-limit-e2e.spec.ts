/**
 * SEC-008: IP rate limiter on POST /api/votes/free actually throttles (429)
 * past its threshold.
 *
 * The route wires `checkRateLimit(\`vote:free:${ip}\`, 30, 60_000)` and
 * returns 429 when it denies (app/api/votes/free/route.ts:56-60, protected —
 * DO NOT EDIT). Existing coverage tests these two facts SEPARATELY:
 *   - tests/unit/voting/free-vote.spec.ts        → checkRateLimit() itself
 *     blocks the (N+1)th call for a given key (real limiter, no route).
 *   - tests/unit/golden-path/free-vote.spec.ts    → the route returns 429
 *     when checkRateLimit is MOCKED to deny (route wiring, no real limiter).
 *
 * Neither exercises both together: the real in-process limiter driven through
 * the real route handler across its actual 30-req/60s threshold. This test
 * closes that gap end-to-end.
 *
 * Protected source: frontend-web/app/api/votes/free/route.ts (DO NOT EDIT).
 * Only the downstream service call and Supabase client are mocked; the rate
 * limiter is the REAL module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, makeFreeVoteResult, makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/server/voting/free-vote.service', () => ({ castFreeVote: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
// Deliberately NOT mocking '@/src/lib/voting/rate-limit' — this test wants the
// real sliding-window bucket logic driven through the real route.

import { POST } from '../../../app/api/votes/free/route';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { createClient } from '@/lib/supabase/server';

describe('SEC-008: /api/votes/free rate limiter throttles past 30 req/min per IP (real limiter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(castFreeVote).mockResolvedValue(makeFreeVoteResult() as any);
  });

  it('allows the first 30 requests from one IP and 429s the 31st', async () => {
    // Unique IP per test run so buckets from other tests/files never bleed in
    // (the limiter module holds process-global state — see rate-limit.ts).
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const req = makeRequest('/api/votes/free', {
        body: { contestId: 'contest-001', contestantId: 'contestant-abc' },
        ip,
      });
      const res = await POST(req);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('does not throttle a different IP after one IP is exhausted', async () => {
    const hotIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const coldIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    for (let i = 0; i < 31; i++) {
      await POST(makeRequest('/api/votes/free', {
        body: { contestId: 'contest-001', contestantId: 'contestant-abc' },
        ip: hotIp,
      }));
    }

    const res = await POST(makeRequest('/api/votes/free', {
      body: { contestId: 'contest-001', contestantId: 'contestant-abc' },
      ip: coldIp,
    }));
    expect(res.status).toBe(200);
  });
});
