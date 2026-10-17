import { describe, expect, it } from 'vitest';
import { dropOff } from './funnelMath';

describe('dropOff(prev, cur)', () => {
  it('computes rounded percentage', () => {
    expect(dropOff(10, 4)).toBe(60);
    expect(dropOff(3, 2)).toBe(33);
  });
  it('guards prev === 0 (no NaN/Infinity)', () => {
    expect(dropOff(0, 0)).toBe(0);
    expect(dropOff(0, 5)).toBe(0);
  });
});
