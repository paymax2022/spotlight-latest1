/**
 * Film Academy composite format pricing — pure helpers.
 *
 * Under test: src/server/services/academy/pricing.ts. These helpers are the
 * single source for seeding an area's five format rows, merging stored rows
 * onto the catalogue, and pricing an applicant's tuition. No I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  ACADEMY_PRICING_FALLBACK_KEY,
  ACADEMY_PRICING_KEYS,
  ACADEMY_PRICING_STRUCTURE,
  attachPricingOptions,
  defaultPricingRows,
  isPricingKey,
  pricingDefinition,
  tuitionForFormat,
  type AcademyPricingKey,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';

const LAUNCH_PRICES: Record<AcademyPricingKey, number> = {
  weekend_day: 50000,
  weekend_boarding: 80000,
  weekday_day: 100000,
  weekday_boarding: 150000,
  full_time_boarding: 200000,
};

function row(
  area_id: string,
  key: string,
  price_ngn: number | string,
  overrides: Partial<AreaPricingOptionRow> = {},
): AreaPricingOptionRow {
  return {
    area_id,
    key,
    label: `stored ${key}`,
    note: null,
    // The DB column is numeric — PostgREST hands it back as a string.
    price_ngn: price_ngn as number,
    sort_order: 0,
    ...overrides,
  };
}

describe('launch structure', () => {
  it('has exactly the five keys, in sort order, at the launch prices', () => {
    expect(ACADEMY_PRICING_STRUCTURE.map((o) => o.key)).toEqual([...ACADEMY_PRICING_KEYS]);
    const sorts = ACADEMY_PRICING_STRUCTURE.map((o) => o.sort_order);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    for (const o of ACADEMY_PRICING_STRUCTURE) expect(o.price_ngn).toBe(LAUNCH_PRICES[o.key]);
  });

  it('falls back to the cheapest format for legacy clients', () => {
    expect(ACADEMY_PRICING_FALLBACK_KEY).toBe('weekend_day');
    const cheapest = Math.min(...ACADEMY_PRICING_STRUCTURE.map((o) => o.price_ngn));
    expect(pricingDefinition(ACADEMY_PRICING_FALLBACK_KEY).price_ngn).toBe(cheapest);
  });
});

describe('isPricingKey', () => {
  it.each([...ACADEMY_PRICING_KEYS])('accepts %s', (key) => {
    expect(isPricingKey(key)).toBe(true);
  });

  it.each(['', 'weekend', 'WEEKEND_DAY', ' weekend_day', 'monthly'])('rejects unknown string %j', (v) => {
    expect(isPricingKey(v)).toBe(false);
  });

  it.each([undefined, null, 0, 1, true, {}, ['weekend_day'], { key: 'weekend_day' }])(
    'rejects non-string %j',
    (v) => {
      expect(isPricingKey(v)).toBe(false);
    },
  );
});

describe('pricingDefinition', () => {
  it('returns the definition for a known key', () => {
    expect(pricingDefinition('weekday_boarding')).toMatchObject({
      key: 'weekday_boarding',
      price_ngn: 150000,
    });
  });

  it('falls back to the first structure entry for an unknown key', () => {
    expect(pricingDefinition('bogus' as AcademyPricingKey)).toBe(ACADEMY_PRICING_STRUCTURE[0]);
  });
});

describe('defaultPricingRows', () => {
  it('returns the five launch rows for the area with server-owned label/price/sort', () => {
    const rows = defaultPricingRows('area-1');
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      ACADEMY_PRICING_STRUCTURE.map((o) => ({
        area_id: 'area-1',
        key: o.key,
        label: o.label,
        note: o.note,
        price_ngn: o.price_ngn,
        sort_order: o.sort_order,
      })),
    );
  });

  it('returns fresh rows, not references into the structure', () => {
    const rows = defaultPricingRows('area-1');
    rows[0].price_ngn = 1;
    expect(ACADEMY_PRICING_STRUCTURE[0].price_ngn).toBe(50000);
  });
});

describe('attachPricingOptions', () => {
  it('gives an area with no stored rows the full launch structure', () => {
    const [area] = attachPricingOptions([{ id: 'a1', slug: 'acting' }], []);
    expect(area.slug).toBe('acting');
    expect(area.pricing_options).toEqual(ACADEMY_PRICING_STRUCTURE);
  });

  it('overrides only the stored keys, keeping launch defaults for the rest', () => {
    const [area] = attachPricingOptions(
      [{ id: 'a1' }],
      [row('a1', 'weekday_day', 120000, { label: 'Weekdays', note: 'Lagos', sort_order: 30 })],
    );
    const byKey = Object.fromEntries(area.pricing_options.map((o) => [o.key, o]));
    expect(byKey.weekday_day).toEqual({
      key: 'weekday_day',
      label: 'Weekdays',
      note: 'Lagos',
      price_ngn: 120000,
      sort_order: 30,
    });
    expect(byKey.weekend_day).toBe(ACADEMY_PRICING_STRUCTURE[0]);
    expect(byKey.full_time_boarding.price_ngn).toBe(200000);
  });

  it('ignores stored rows with an unknown key', () => {
    const [area] = attachPricingOptions(
      [{ id: 'a1' }],
      [row('a1', 'monthly', 1), row('a1', 'weekend_day', 55000)],
    );
    expect(area.pricing_options).toHaveLength(5);
    expect(area.pricing_options.map((o) => o.key)).toEqual([...ACADEMY_PRICING_KEYS]);
    expect(area.pricing_options[0].price_ngn).toBe(55000);
  });

  it('orders options by the structure, not by stored sort_order', () => {
    const [area] = attachPricingOptions(
      [{ id: 'a1' }],
      [
        row('a1', 'full_time_boarding', 210000, { sort_order: 1 }),
        row('a1', 'weekend_day', 51000, { sort_order: 99 }),
      ],
    );
    expect(area.pricing_options.map((o) => o.key)).toEqual([...ACADEMY_PRICING_KEYS]);
  });

  it('coerces a numeric-string price with Number()', () => {
    const [area] = attachPricingOptions([{ id: 'a1' }], [row('a1', 'weekend_boarding', '80000.00')]);
    const opt = area.pricing_options.find((o) => o.key === 'weekend_boarding')!;
    expect(opt.price_ngn).toBe(80000);
    expect(typeof opt.price_ngn).toBe('number');
  });

  it("does not leak another area's rows", () => {
    const [a1, a2] = attachPricingOptions(
      [{ id: 'a1' }, { id: 'a2' }],
      [row('a2', 'weekend_day', 99000)],
    );
    expect(a1.pricing_options[0].price_ngn).toBe(50000);
    expect(a2.pricing_options[0].price_ngn).toBe(99000);
  });

  it('preserves the caller fields and the area order', () => {
    const out = attachPricingOptions(
      [{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }],
      [],
    );
    expect(out.map((a) => [a.id, a.label])).toEqual([['b', 'B'], ['a', 'A']]);
  });
});

describe('tuitionForFormat', () => {
  const rows = [
    row('a1', 'weekday_day', 110000),
    row('a2', 'weekday_day', '95000.00'),
    row('a1', 'weekend_day', 52000),
  ];

  it('sums the stored per-area price for the chosen format', () => {
    expect(tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekday_day', rows)).toBe(205000);
  });

  it('falls back to the launch price for an area with no row in that format', () => {
    // a2 has no weekend_day row → launch 50,000.
    expect(tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekend_day', rows)).toBe(52000 + 50000);
  });

  it('is 0 for an empty area list', () => {
    expect(tuitionForFormat([], 'full_time_boarding', rows)).toBe(0);
  });

  it('changes when one area has a different stored price', () => {
    const base = tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekday_day', rows);
    const repriced = tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekday_day', [
      row('a1', 'weekday_day', 110000),
      row('a2', 'weekday_day', 125000),
    ]);
    expect(repriced - base).toBe(30000);
  });

  it("does not price an area from another format's row", () => {
    // a1 has weekend_day + weekday_day rows only; full_time_boarding is launch.
    expect(tuitionForFormat([{ id: 'a1' }], 'full_time_boarding', rows)).toBe(200000);
  });
});
