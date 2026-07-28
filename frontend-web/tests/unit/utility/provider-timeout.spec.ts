import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getUtilityProviderTimeoutMs,
  UtilityProviderTimeoutError,
  withUtilityProviderTimeout,
} from '@/src/server/utility/provider-timeout';

const OLD_TIMEOUT = process.env.UTILITY_PROVIDER_TIMEOUT_MS;

describe('utility provider timeout helpers', () => {
  beforeEach(() => {
    delete process.env.UTILITY_PROVIDER_TIMEOUT_MS;
  });

  afterEach(() => {
    if (OLD_TIMEOUT === undefined) delete process.env.UTILITY_PROVIDER_TIMEOUT_MS;
    else process.env.UTILITY_PROVIDER_TIMEOUT_MS = OLD_TIMEOUT;
  });

  it('uses provider config before env defaults', () => {
    process.env.UTILITY_PROVIDER_TIMEOUT_MS = '30000';
    expect(getUtilityProviderTimeoutMs({ timeout_ms: 5000 })).toBe(5000);
  });

  it('clamps excessive timeout values', () => {
    expect(getUtilityProviderTimeoutMs({ timeout_ms: 999_999 })).toBe(120_000);
  });

  it('falls back to environment timeout', () => {
    process.env.UTILITY_PROVIDER_TIMEOUT_MS = '25000';
    expect(getUtilityProviderTimeoutMs({})).toBe(25_000);
  });

  it('rejects with a timeout error when provider work exceeds the budget', async () => {
    await expect(
      withUtilityProviderTimeout(
        new Promise((resolve) => setTimeout(() => resolve('late'), 20)),
        1,
      ),
    ).rejects.toBeInstanceOf(UtilityProviderTimeoutError);
  });
});
