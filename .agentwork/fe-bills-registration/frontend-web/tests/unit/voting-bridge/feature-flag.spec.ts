/**
 * Bridge feature flag tests.
 * VOTES_BRIDGE_ENABLED controls whether votes are bridged or fall through directly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isBridgeEnabled } from '@/src/server/voting-bridge/feature-flag';

describe('isBridgeEnabled', () => {
  afterEach(() => { delete process.env.VOTES_BRIDGE_ENABLED; });

  it('returns false when VOTES_BRIDGE_ENABLED is not set', () => {
    expect(isBridgeEnabled()).toBe(false);
  });

  it('returns true only when VOTES_BRIDGE_ENABLED is exactly "true"', () => {
    process.env.VOTES_BRIDGE_ENABLED = 'true';
    expect(isBridgeEnabled()).toBe(true);
  });

  it('returns false for "1"', () => {
    process.env.VOTES_BRIDGE_ENABLED = '1';
    expect(isBridgeEnabled()).toBe(false);
  });

  it('returns false for "True" (case sensitive)', () => {
    process.env.VOTES_BRIDGE_ENABLED = 'True';
    expect(isBridgeEnabled()).toBe(false);
  });
});
