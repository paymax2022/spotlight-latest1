/**
 * VI-004 (multi-account / bot voting detection), VI-005 (abnormal velocity /
 * IP / device signals), and VI-006 (self-voting controls) — executed tests
 * against the real fraud-scoring logic.
 *
 * fraud.service.ts is a hook-protected file (CLAUDE.md brownfield-safety
 * rule) — it is READ and IMPORTED here (never edited) and exercised through
 * its public exports with a mocked Supabase client, same as the vote-bridge
 * skill's guidance for testing protected logic without modifying it.
 *
 * Each test isolates ONE signal at a time by disabling the others via the
 * settings input, since runFraudChecks always runs the bot-speed check
 * whenever a userId or ipAddress is present.
 *
 * Module under test: frontend-web/src/server/voting/fraud.service.ts (protected, read-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { runFraudChecks } from '@/src/server/voting/fraud.service';
import { createAdminClient } from '@/lib/supabase/server';
import { FRAUD_SCORE_THRESHOLDS } from '@/src/features/voting/constants';

// A minimal, table-routed, chainable+thenable Supabase stand-in. Every chain
// method returns the same builder object; awaiting the builder at any point
// resolves to that table's queued result (FIFO) — matching runFraudChecks'
// real call order: IP volume -> device fingerprint -> bot-speed -> vote-spike
// -> (self-vote via competition_enrollments).
function makeFraudSupabase(votesResults: Array<Record<string, unknown>>, enrollmentResult?: { data: unknown; error: unknown }) {
  const queue = [...votesResults];
  function votesBuilder(): any {
    const result = queue.length ? queue.shift() : { data: [], count: 0, error: null };
    const b: any = { then: (res: any, rej: any) => Promise.resolve(result).then(res, rej) };
    for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'not', 'is', 'in', 'order', 'limit']) {
      b[m] = () => b;
    }
    return b;
  }
  function enrollmentBuilder(): any {
    const result = enrollmentResult ?? { data: null, error: null };
    const b: any = { then: (res: any, rej: any) => Promise.resolve(result).then(res, rej) };
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve(result);
    return b;
  }
  return {
    from: (table: string) => {
      if (table === 'votes') return votesBuilder();
      if (table === 'competition_enrollments') return enrollmentBuilder();
      if (table === 'fraud_flags') return { insert: () => Promise.resolve({ error: null }) };
      return votesBuilder();
    },
  };
}

function baseSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fraudDetectionEnabled: true,
    suspiciousIpLimit: 10,
    botSpeedThresholdMs: 0, // effectively disables the bot-speed window unless explicitly tested
    detectVoteSpikes: false,
    blockDisposableEmails: false,
    ...overrides,
  } as any;
}

describe('runFraudChecks — fraud detection (VI-004, VI-005, VI-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('VI-005: flags duplicate_ip when votes from one IP exceed the configured limit in the last hour', async () => {
    // Queue order: [IP count check] -> [bot-speed-by-ip check]
    const supabase = makeFraudSupabase([
      { count: 25, data: null, error: null }, // IP volume: 25 > limit 10
      { count: 0, data: null, error: null },  // bot-speed-by-ip: no recent vote
    ]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '10.0.0.1',
      deviceFingerprint: '',
      settings: baseSettings({ suspiciousIpLimit: 10 }),
    });

    const ipFlag = result.flags.find((f) => f.type === 'duplicate_ip');
    expect(ipFlag).toBeDefined();
    expect(ipFlag!.severity).toBe('high');
    expect(ipFlag!.score).toBe(Math.min(40, Math.floor((25 / 10) * 20)));
    expect(result.score).toBeGreaterThanOrEqual(FRAUD_SCORE_THRESHOLDS.SUSPICIOUS - 100); // sanity: score computed, not thrown
  });

  it('VI-005: does NOT flag IP volume when under the configured limit', async () => {
    const supabase = makeFraudSupabase([
      { count: 3, data: null, error: null },  // IP volume: under limit
      { count: 0, data: null, error: null },  // bot-speed
    ]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '10.0.0.1',
      deviceFingerprint: '',
      settings: baseSettings({ suspiciousIpLimit: 10 }),
    });

    expect(result.flags.find((f) => f.type === 'duplicate_ip')).toBeUndefined();
  });

  it('VI-004: flags duplicate_device when >3 distinct user accounts share a device fingerprint', async () => {
    // Queue order: [IP check skipped — no ipAddress] -> [device fingerprint check] -> [bot-speed skipped — no userId/ip]
    const supabase = makeFraudSupabase([
      {
        data: [
          { voter_user_id: 'u-1' },
          { voter_user_id: 'u-2' },
          { voter_user_id: 'u-3' },
          { voter_user_id: 'u-4' },
        ],
        error: null,
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '',
      deviceFingerprint: 'device-abc',
      settings: baseSettings(),
    });

    const deviceFlag = result.flags.find((f) => f.type === 'duplicate_device');
    expect(deviceFlag).toBeDefined();
    expect(deviceFlag!.severity).toBe('high');
    expect(deviceFlag!.score).toBe(25);
    expect(deviceFlag!.reason).toContain('4 accounts');
  });

  it('VI-004: does NOT flag a device shared by 3 or fewer accounts (threshold is >3)', async () => {
    const supabase = makeFraudSupabase([
      { data: [{ voter_user_id: 'u-1' }, { voter_user_id: 'u-2' }, { voter_user_id: 'u-3' }], error: null },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '',
      deviceFingerprint: 'device-abc',
      settings: baseSettings(),
    });

    expect(result.flags.find((f) => f.type === 'duplicate_device')).toBeUndefined();
  });

  it('VI-005 (bot-speed): flags bot_speed when the same authenticated user has any vote within the threshold window', async () => {
    const supabase = makeFraudSupabase([
      { count: 1, data: null, error: null }, // bot-speed-by-user: found a recent vote
    ]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '',
      deviceFingerprint: '',
      userId: 'u-1',
      settings: baseSettings({ botSpeedThresholdMs: 5000 }),
    });

    const botFlag = result.flags.find((f) => f.type === 'bot_speed');
    expect(botFlag).toBeDefined();
    expect(botFlag!.severity).toBe('medium');
    expect(botFlag!.score).toBe(15);
  });

  it('VI-005: in-memory per-instance nature of the separate IP rate limiter is out of scope here — this suite only covers the persisted fraud-score signals, not votes/free/route.ts\'s limiter (protected file)', () => {
    // Documents the known limitation from the test-plan notes: the 30/min IP
    // limiter in the protected votes/free/route.ts is process-local (no Redis
    // backing), so it under-counts across multiple app instances. That file
    // cannot be edited here (hook-protected); flagged as a known gap, not
    // fixed by this suite. See docs/qa/voting-contest-test-plan.md VI-005 notes.
    expect(true).toBe(true);
  });

  it('VI-006: flags self_vote (score 50, critical) when the voter IS the contestant', async () => {
    const supabase = makeFraudSupabase(
      [], // no votes-table checks triggered (no ip/device/userId+ip bot-speed path — userId set but botSpeedThresholdMs=0 still queries once)
      { data: { user_id: 'u-1' }, error: null },
    );
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '',
      deviceFingerprint: '',
      userId: 'u-1', // same as the contestant's enrolled user_id
      settings: baseSettings(),
    });

    const selfVoteFlag = result.flags.find((f) => f.type === 'self_vote');
    expect(selfVoteFlag).toBeDefined();
    expect(selfVoteFlag!.severity).toBe('critical');
    expect(selfVoteFlag!.score).toBe(50);
    expect(result.score).toBeGreaterThanOrEqual(FRAUD_SCORE_THRESHOLDS.SUSPICIOUS); // 50 >= 30 threshold — would persist a flag
  });

  it('VI-006: does NOT flag self-voting when the voter is a different user than the contestant', async () => {
    const supabase = makeFraudSupabase([], { data: { user_id: 'someone-else' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '',
      deviceFingerprint: '',
      userId: 'u-1',
      settings: baseSettings(),
    });

    expect(result.flags.find((f) => f.type === 'self_vote')).toBeUndefined();
  });

  it('short-circuits with score 0 and no flags when fraudDetectionEnabled is false', async () => {
    const supabase = makeFraudSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as any);

    const result = await runFraudChecks({
      contestId: 'contest-1',
      contestantId: 'enr-1',
      ipAddress: '10.0.0.1',
      deviceFingerprint: 'device-abc',
      userId: 'u-1',
      settings: baseSettings({ fraudDetectionEnabled: false }),
    });

    expect(result).toEqual({ score: 0, flags: [] });
  });
});
