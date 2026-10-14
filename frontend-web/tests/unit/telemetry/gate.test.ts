import { describe, it, expect } from 'vitest';
import { shouldEmit } from '@/src/features/telemetry/gate';

describe('shouldEmit', () => {
  it.each([
    ['true', true, true],
    ['true', false, false],
    ['false', true, false],
    [undefined, true, false],
    ['TRUE', true, false],
    ['', true, false],
  ])('flag=%s user=%s -> %s', (flag, user, want) => {
    expect(shouldEmit(flag as string | undefined, user)).toBe(want);
  });
});
