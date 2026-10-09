/**
 * Feature flag contract tests.
 *
 * Every fintech module is behind a flag that defaults to false — EXCEPT
 * tierLimits, which is an enforcement flag (not a feature mount) and defaults
 * ON to mirror the Go backend's getEnvBool(..., true) + the fail-closed money
 * rule. These tests lock in that invariant so a bad env var or merge mistake
 * cannot silently enable a half-built feature in production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the module under test — flags re-read process.env on each call
// so we can mutate process.env between tests without module reimport.
import { featureFlags, requireFeature } from '@/src/lib/feature-flags';

const ALL_FLAGS = [
  'FEATURE_WALLET_ENABLED',
  'FEATURE_KYC_ENABLED',
  'FEATURE_VIRTUAL_ACCOUNTS_ENABLED',
  'VOTES_BRIDGE_ENABLED',
  'FEATURE_REFERRALS_ENABLED',
  'FEATURE_FINTECH_ADMIN_ENABLED',
  'FEATURE_TIER_LIMITS_ENABLED',
  'FEATURE_FX_ORCHESTRATION_ENABLED',
  'FEATURE_FX_ENABLED',
] as const;

describe('Feature flags', () => {
  // Snapshot original env values and restore after each test
  let originalValues: Record<string, string | undefined>;

  beforeEach(() => {
    originalValues = Object.fromEntries(ALL_FLAGS.map((k) => [k, process.env[k]]));
    // Ensure all flags are OFF at test start
    for (const key of ALL_FLAGS) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(originalValues)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('wallet flag is OFF by default', () => expect(featureFlags.wallet()).toBe(false));
  it('kyc flag is OFF by default', () => expect(featureFlags.kyc()).toBe(false));
  it('virtualAccounts flag is OFF by default', () => expect(featureFlags.virtualAccounts()).toBe(false));
  it('votesBridge flag is OFF by default', () => expect(featureFlags.votesBridge()).toBe(false));
  it('referrals flag is OFF by default', () => expect(featureFlags.referrals()).toBe(false));
  it('fintechAdmin flag is OFF by default', () => expect(featureFlags.fintechAdmin()).toBe(false));
  it('tierLimits flag is ON by default (fail-closed enforcement, mirrors Go)', () =>
    expect(featureFlags.tierLimits()).toBe(true));

  it('tierLimits disables only on an explicit "false"/"0"/"no"', () => {
    for (const val of ['false', '0', 'no']) {
      process.env.FEATURE_TIER_LIMITS_ENABLED = val;
      expect(featureFlags.tierLimits()).toBe(false);
    }
    // Anything else — including a typo like "ture" — stays enforced.
    for (const val of ['true', '1', 'yes', 'ture', '']) {
      process.env.FEATURE_TIER_LIMITS_ENABLED = val;
      expect(featureFlags.tierLimits()).toBe(true);
    }
  });

  it('wallet flag turns ON when env var is exactly "true"', () => {
    process.env.FEATURE_WALLET_ENABLED = 'true';
    expect(featureFlags.wallet()).toBe(true);
  });

  it('does not activate on "1", "yes", "TRUE", or "True" — only exact "true"', () => {
    for (const val of ['1', 'yes', 'TRUE', 'True', 'on']) {
      process.env.FEATURE_WALLET_ENABLED = val;
      expect(featureFlags.wallet()).toBe(false);
    }
  });

  it('deactivates immediately when env var is removed', () => {
    process.env.FEATURE_KYC_ENABLED = 'true';
    expect(featureFlags.kyc()).toBe(true);
    delete process.env.FEATURE_KYC_ENABLED;
    expect(featureFlags.kyc()).toBe(false);
  });

  it('requireFeature throws ApiError(503) when the flag is off', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    expect(() => requireFeature('wallet')).toThrow(ApiError);
    expect(() => requireFeature('wallet')).toThrowError(/wallet/i);
    try {
      requireFeature('wallet');
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).status).toBe(503);
    }
  });

  it('requireFeature does not throw when the flag is on', () => {
    process.env.FEATURE_KYC_ENABLED = 'true';
    expect(() => requireFeature('kyc')).not.toThrow();
  });

  it('enabling one flag does not enable another', () => {
    process.env.FEATURE_WALLET_ENABLED = 'true';
    expect(featureFlags.wallet()).toBe(true);
    expect(featureFlags.kyc()).toBe(false);
    expect(featureFlags.votesBridge()).toBe(false);
  });

  it('fx flag is OFF by default', () => expect(featureFlags.fx()).toBe(false));

  it('fx flag tracks the orchestration mount flag, with the legacy var as fallback', () => {
    // The Go mount gate for /api/v1/fx/* is FEATURE_FX_ORCHESTRATION_ENABLED.
    process.env.FEATURE_FX_ORCHESTRATION_ENABLED = 'true';
    expect(featureFlags.fx()).toBe(true);
    delete process.env.FEATURE_FX_ORCHESTRATION_ENABLED;
    // Deployments that only set the legacy FEATURE_FX_ENABLED still pass.
    process.env.FEATURE_FX_ENABLED = 'true';
    expect(featureFlags.fx()).toBe(true);
    delete process.env.FEATURE_FX_ENABLED;
    expect(featureFlags.fx()).toBe(false);
  });
});
