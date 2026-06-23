import { describe, expect, it } from 'vitest';
import { parseUtilityCategory } from '../../../app/api/v1/utility/_utils';

// Cross-agent regression: the billing client sends UPPERCASE category codes
// (AIRTIME / DATA / ELECTRICITY / CABLE_TV) while the canonical category values are
// lowercase. parseUtilityCategory must accept either case so uppercase payloads no
// longer 400 on POST /api/v1/utility/pay.
describe('parseUtilityCategory (case-insensitive)', () => {
  it('accepts the canonical lowercase values', () => {
    expect(parseUtilityCategory('airtime')).toBe('airtime');
    expect(parseUtilityCategory('data')).toBe('data');
    expect(parseUtilityCategory('electricity')).toBe('electricity');
    expect(parseUtilityCategory('cable_tv')).toBe('cable_tv');
    expect(parseUtilityCategory('internet')).toBe('internet');
  });

  it('accepts UPPERCASE values from the billing client', () => {
    expect(parseUtilityCategory('AIRTIME')).toBe('airtime');
    expect(parseUtilityCategory('DATA')).toBe('data');
    expect(parseUtilityCategory('ELECTRICITY')).toBe('electricity');
    expect(parseUtilityCategory('CABLE_TV')).toBe('cable_tv');
  });

  it('accepts mixed case and surrounding whitespace', () => {
    expect(parseUtilityCategory('  Airtime ')).toBe('airtime');
    expect(parseUtilityCategory('Cable_Tv')).toBe('cable_tv');
  });

  it('rejects unknown categories and null/empty', () => {
    expect(parseUtilityCategory('water')).toBeUndefined();
    expect(parseUtilityCategory('')).toBeUndefined();
    expect(parseUtilityCategory(null)).toBeUndefined();
  });
});
