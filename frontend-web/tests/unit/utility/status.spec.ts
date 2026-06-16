import { describe, expect, it } from 'vitest';
import {
  canRequeryUtilityStatus,
  canReverseUtilityTransaction,
  isTerminalUtilityStatus,
  nextStatusFromProvider,
} from '@/src/server/utility/status';

describe('utility transaction status rules', () => {
  it('maps provider statuses into internal transaction statuses', () => {
    expect(nextStatusFromProvider('successful')).toBe('successful');
    expect(nextStatusFromProvider('pending')).toBe('provider_pending');
    expect(nextStatusFromProvider('failed')).toBe('failed');
  });

  it('only terminal statuses are treated as final', () => {
    expect(isTerminalUtilityStatus('successful')).toBe(true);
    expect(isTerminalUtilityStatus('reversed')).toBe(true);
    expect(isTerminalUtilityStatus('provider_pending')).toBe(false);
  });

  it('permits requery before final success or reversal', () => {
    expect(canRequeryUtilityStatus('provider_pending')).toBe(true);
    expect(canRequeryUtilityStatus('wallet_debited')).toBe(true);
    expect(canRequeryUtilityStatus('successful')).toBe(false);
  });

  it('limits reversal eligibility to unsettled or failed money-path states', () => {
    expect(canReverseUtilityTransaction('wallet_debited')).toBe(true);
    expect(canReverseUtilityTransaction('failed')).toBe(true);
    expect(canReverseUtilityTransaction('successful')).toBe(false);
  });
});
