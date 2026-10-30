import { describe, expect, it } from 'vitest';
import { nairaInputToKobo, localDateTimeToRfc3339 } from './busReportsAdminService';

describe('nairaInputToKobo', () => {
  it('converts naira strings to integer kobo without float drift', () => {
    expect(nairaInputToKobo('1200')).toBe(120000);
    expect(nairaInputToKobo('1,200.5')).toBe(120050);
    expect(nairaInputToKobo('₦ 0.29')).toBe(29);
    expect(nairaInputToKobo('19.99')).toBe(1999); // 19.99*100 is 1998.9999… in floats
    expect(nairaInputToKobo('0')).toBe(0);
  });
  it('rejects malformed, negative and over-precise amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '1.', '.5']) {
      expect(nairaInputToKobo(bad)).toBeNull();
    }
  });
});

describe('localDateTimeToRfc3339', () => {
  it('emits RFC3339 UTC without milliseconds', () => {
    expect(localDateTimeToRfc3339('2026-11-01T07:30')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it('rejects junk', () => {
    expect(localDateTimeToRfc3339('')).toBeNull();
    expect(localDateTimeToRfc3339('tomorrow')).toBeNull();
  });
});
