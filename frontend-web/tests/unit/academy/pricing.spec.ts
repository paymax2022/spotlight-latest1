/**
 * Film Academy training-format pricing — pure helpers.
 *
 * Under test: src/server/services/academy/pricing.ts. These helpers do the
 * ARITHMETIC and the MERGE; they never decide which formats exist, because the
 * operator manages that list in academy_pricing_formats. So every function is
 * handed the catalogue it should price against, and this spec passes one in.
 * No I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  ACADEMY_LAUNCH_FORMATS,
  activeFormatKeys,
  activeFormats,
  attachPricingOptions,
  defaultPricingRows,
  fallbackFormat,
  fallbackFormatKey,
  orderFormats,
  pricingDefinition,
  pricingStructureFor,
  parseAreaSelections,
  tuitionForFormat,
  tuitionForSelections,
  type AcademyPricingFormat,
  type AreaPricingOptionRow,
} from '@/src/server/services/academy/pricing';

function fmt(
  key: string,
  price_ngn: number,
  overrides: Partial<AcademyPricingFormat> = {},
): AcademyPricingFormat {
  return {
    key,
    label: `label ${key}`,
    note: null,
    sort_order: price_ngn,
    is_active: true,
    default_price_ngn: price_ngn,
    ...overrides,
  };
}

const LAUNCH: AcademyPricingFormat[] = [
  fmt('weekend_day', 50000, { label: 'Weekend (No Boarding)', sort_order: 10 }),
  fmt('weekend_boarding', 80000, { label: 'Weekend (With Boarding)', sort_order: 20 }),
  fmt('weekday_day', 100000, { label: 'Week days (No Boarding)', sort_order: 30 }),
  fmt('weekday_boarding', 150000, { label: 'Week days (Boarding)', sort_order: 40 }),
  fmt('full_time_boarding', 200000, { label: '1 month - Boarding', sort_order: 50 }),
];

const KEYS = LAUNCH.map((f) => f.key);

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

describe('the launch structure', () => {
  it('is the five keys the migration seeds, at the launch prices', () => {
    expect(ACADEMY_LAUNCH_FORMATS.map((f) => f.key)).toEqual(KEYS);
    const sorts = ACADEMY_LAUNCH_FORMATS.map((f) => f.sort_order);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    for (const f of ACADEMY_LAUNCH_FORMATS) {
      expect(f.is_active).toBe(true);
      expect(f.default_price_ngn).toBeGreaterThan(0);
    }
  });
});

describe('orderFormats', () => {
  it('sorts by the operator order and never sorts in place', () => {
    const input = [fmt('b', 300), fmt('a', 100), fmt('c', 200)];
    const out = orderFormats(input);
    expect(out.map((f) => f.default_price_ngn)).toEqual([100, 200, 300]);
    expect(input.map((f) => f.key)).toEqual(['b', 'a', 'c']);
  });

  it('breaks a sort_order tie on the key so the order is deterministic', () => {
    expect(orderFormats([fmt('zeta', 1, { sort_order: 5 }), fmt('alpha', 2, { sort_order: 5 })]).map((f) => f.key)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('drops a row with no usable key', () => {
    expect(orderFormats([fmt('ok', 10), { ...fmt('', 1), key: '' }, undefined as never, null as never])).toEqual([
      expect.objectContaining({ key: 'ok' }),
    ]);
  });
});

describe('activeFormats / activeFormatKeys', () => {
  it('offers only what the operator left on, in their order', () => {
    const withdrawn = LAUNCH.map((f) => (f.key === 'weekend_boarding' ? { ...f, is_active: false } : f));
    expect(activeFormats(withdrawn).map((f) => f.key)).toEqual([
      'weekend_day',
      'weekday_day',
      'weekday_boarding',
      'full_time_boarding',
    ]);
    expect(activeFormatKeys(withdrawn).has('weekend_boarding')).toBe(false);
  });

  it('reorders when the operator reorders', () => {
    const flipped = LAUNCH.map((f) => ({ ...f, sort_order: 60 - f.sort_order }));
    expect(activeFormats(flipped).map((f) => f.key)).toEqual([...KEYS].reverse());
  });

  it('presents a format the operator added', () => {
    const withNew = [...LAUNCH, fmt('summer_intensive', 120000, { sort_order: 5 })];
    expect(activeFormats(withNew).map((f) => f.key)[0]).toBe('summer_intensive');
    expect(activeFormatKeys(withNew).has('summer_intensive')).toBe(true);
  });

  it('falls back to the launch list when everything is withdrawn or the read is empty', () => {
    const allOff = LAUNCH.map((f) => ({ ...f, is_active: false }));
    expect(activeFormats(allOff).map((f) => f.key)).toEqual(KEYS);
    expect(activeFormats([]).map((f) => f.key)).toEqual(KEYS);
  });
});

describe('fallbackFormat — what a legacy client is priced in', () => {
  it('is the cheapest format ON OFFER, not a hardcoded key', () => {
    expect(fallbackFormatKey(LAUNCH)).toBe('weekend_day');
    const withdrawn = LAUNCH.map((f) => (f.key === 'weekend_day' ? { ...f, is_active: false } : f));
    expect(fallbackFormatKey(withdrawn)).toBe('weekend_boarding');
  });

  it('follows the operator when they add a cheaper format', () => {
    expect(fallbackFormatKey([...LAUNCH, fmt('taster', 25000, { sort_order: 60 })])).toBe('taster');
  });

  it('breaks a price tie on the operator order', () => {
    expect(fallbackFormat(LAUNCH).key).toBe('weekend_day');
    const tie = [...LAUNCH, fmt('a_new', 50000, { sort_order: 5 })];
    expect(fallbackFormat(tie).key).toBe('a_new');
  });

  it('never falls back above what is on offer', () => {
    const allOff = LAUNCH.map((f) => ({ ...f, is_active: false }));
    expect(fallbackFormatKey(allOff)).toBe('weekend_day');
  });
});

describe('pricingDefinition', () => {
  it('returns the managed row for a known key', () => {
    expect(pricingDefinition('weekday_boarding', LAUNCH)).toMatchObject({
      key: 'weekday_boarding',
      default_price_ngn: 150000,
    });
  });

  it('returns the first on-offer format for a key nobody created', () => {
    expect(pricingDefinition('bogus', LAUNCH)).toBe(activeFormats(LAUNCH)[0]);
  });
});

describe('defaultPricingRows', () => {
  it('seeds one row per on-offer format at its own default price', () => {
    const rows = defaultPricingRows('area-1', LAUNCH);
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      activeFormats(LAUNCH).map((f) => ({
        area_id: 'area-1',
        key: f.key,
        label: f.label,
        note: f.note,
        price_ngn: f.default_price_ngn,
        sort_order: f.sort_order,
      })),
    );
  });

  it('includes a format the operator added and skips one they withdrew', () => {
    const catalogue = [
      ...LAUNCH.map((f) => (f.key === 'weekend_boarding' ? { ...f, is_active: false } : f)),
      fmt('summer_intensive', 120000, { sort_order: 15 }),
    ];
    expect(defaultPricingRows('area-1', catalogue).map((r) => r.key)).toEqual([
      'weekend_day',
      'summer_intensive',
      'weekday_day',
      'weekday_boarding',
      'full_time_boarding',
    ]);
  });

  it('returns fresh rows, not references into the catalogue', () => {
    const catalogue = [...LAUNCH];
    const rows = defaultPricingRows('area-1', catalogue);
    rows[0].price_ngn = 1;
    expect(catalogue[0].default_price_ngn).toBe(50000);
  });
});

describe('attachPricingOptions', () => {
  it('gives an area with no stored rows the on-offer defaults', () => {
    const [area] = attachPricingOptions([{ id: 'a1', slug: 'acting' }], [], LAUNCH);
    expect(area.slug).toBe('acting');
    expect(area.pricing_options.map((o) => o.key)).toEqual(KEYS);
    expect(area.pricing_options[0].price_ngn).toBe(50000);
  });

  it('takes identity from the catalogue and money from the stored row', () => {
    const [area] = attachPricingOptions(
      [{ id: 'a1' }],
      [row('a1', 'weekday_day', 120000, { label: 'HACKED', note: 'Lagos', sort_order: 30 })],
      LAUNCH,
    );
    const byKey = Object.fromEntries(area.pricing_options.map((o) => [o.key, o]));
    expect(byKey.weekday_day).toEqual({
      key: 'weekday_day',
      label: 'Week days (No Boarding)',
      note: null,
      price_ngn: 120000,
      sort_order: 30,
    });
    expect(byKey.weekend_day.price_ngn).toBe(50000);
    expect(byKey.full_time_boarding.price_ngn).toBe(200000);
  });

  it('ignores a stored label/note — the operator owns the wording', () => {
    const [area] = attachPricingOptions([{ id: 'a1' }], [row('a1', 'weekend_day', 50000, { note: '30 days' })], LAUNCH);
    expect(area.pricing_options[0].note).toBe(null);
  });

  it('hides a withdrawn format from applicants but shows it to the console', () => {
    const catalogue = LAUNCH.map((f) => (f.key === 'weekend_boarding' ? { ...f, is_active: false } : f));
    const rows = [row('a1', 'weekend_boarding', 90000)];
    expect(attachPricingOptions([{ id: 'a1' }], rows, catalogue)[0].pricing_options.map((o) => o.key)).toEqual([
      'weekend_day',
      'weekday_day',
      'weekday_boarding',
      'full_time_boarding',
    ]);
    const admin = attachPricingOptions([{ id: 'a1' }], rows, catalogue, { includeInactive: true })[0];
    expect(admin.pricing_options.map((o) => o.key)).toEqual(KEYS);
    expect(admin.pricing_options[1].price_ngn).toBe(90000);
  });

  it('ignores a stored row whose format the operator deleted', () => {
    const [area] = attachPricingOptions([{ id: 'a1' }], [row('a1', 'monthly', 1), row('a1', 'weekend_day', 55000)], LAUNCH);
    expect(area.pricing_options).toHaveLength(5);
    expect(area.pricing_options[0].price_ngn).toBe(55000);
  });

  it('orders options by the catalogue, not by stored sort_order', () => {
    const [area] = attachPricingOptions(
      [{ id: 'a1' }],
      [row('a1', 'full_time_boarding', 210000, { sort_order: 1 }), row('a1', 'weekend_day', 51000, { sort_order: 99 })],
      LAUNCH,
    );
    expect(area.pricing_options.map((o) => o.key)).toEqual(KEYS);
  });

  it('coerces a numeric-string price with Number()', () => {
    const [area] = attachPricingOptions([{ id: 'a1' }], [row('a1', 'weekend_boarding', '80000.00')], LAUNCH);
    const opt = area.pricing_options.find((o) => o.key === 'weekend_boarding')!;
    expect(opt.price_ngn).toBe(80000);
    expect(typeof opt.price_ngn).toBe('number');
  });

  it("does not leak another area's rows", () => {
    const [a1, a2] = attachPricingOptions([{ id: 'a1' }, { id: 'a2' }], [row('a2', 'weekend_day', 99000)], LAUNCH);
    expect(a1.pricing_options[0].price_ngn).toBe(50000);
    expect(a2.pricing_options[0].price_ngn).toBe(99000);
  });

  it('preserves the caller fields and the area order', () => {
    const out = attachPricingOptions([{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }], [], LAUNCH);
    expect(out.map((a) => [a.id, a.label])).toEqual([['b', 'B'], ['a', 'A']]);
  });
});

describe('tuitionForFormat', () => {
  const rows = [row('a1', 'weekday_day', 110000), row('a2', 'weekday_day', '95000.00'), row('a1', 'weekend_day', 52000)];

  it('sums the stored per-area price for the chosen format', () => {
    expect(tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekday_day', rows, LAUNCH)).toBe(205000);
  });

  it('falls back to the format default for an area with no row in that format', () => {
    expect(tuitionForFormat([{ id: 'a1' }, { id: 'a2' }], 'weekend_day', rows, LAUNCH)).toBe(52000 + 50000);
  });

  it('prices in a format the operator added, from its own default', () => {
    const catalogue = [...LAUNCH, fmt('summer_intensive', 130000, { sort_order: 5 })];
    expect(tuitionForFormat([{ id: 'a1' }], 'summer_intensive', rows, catalogue)).toBe(130000);
    expect(tuitionForFormat([{ id: 'a1' }], 'summer_intensive', [row('a1', 'summer_intensive', 132500)], catalogue)).toBe(
      132500,
    );
  });

  it('is 0 for an empty area list', () => {
    expect(tuitionForFormat([], 'full_time_boarding', rows, LAUNCH)).toBe(0);
  });

  it("does not price an area from another format's row", () => {
    expect(tuitionForFormat([{ id: 'a1' }], 'full_time_boarding', rows, LAUNCH)).toBe(200000);
  });
});

describe('tuitionForSelections', () => {
  const areas = [
    { id: 'a1', slug: 'acting' },
    { id: 'a2', slug: 'directing' },
  ];
  const rows = [row('a1', 'weekend_day', 52000), row('a2', 'weekday_boarding', 160000)];

  it('sums each area in the format that area chose', () => {
    expect(tuitionForSelections(areas, { acting: 'weekend_day', directing: 'weekday_boarding' }, rows, LAUNCH)).toBe(
      212000,
    );
  });

  it('prices an area the client never keyed in the cheapest format on offer', () => {
    const catalogue = LAUNCH.map((f) => (f.key === 'weekend_day' ? { ...f, is_active: false } : f));
    // acting has no weekend_day row in play → default is gone from offer, so
    // directing falls to the cheapest on offer (weekend_boarding, 80,000).
    expect(tuitionForSelections(areas, { acting: 'weekend_day' }, rows, catalogue)).toBe(
      52000 + Number(activeFormats(catalogue)[0].default_price_ngn),
    );
  });

  it('is 0 for an empty area list', () => {
    expect(tuitionForSelections([], { acting: 'weekend_day' }, rows, LAUNCH)).toBe(0);
  });
});

describe('parseAreaSelections', () => {
  const allowed = activeFormatKeys(LAUNCH);

  it('parses slug→key pairs', () => {
    expect(
      parseAreaSelections(
        [
          { slug: 'acting', key: 'weekend_day' },
          { slug: 'directing', key: 'weekday_boarding' },
        ],
        allowed,
      ),
    ).toEqual({ acting: 'weekend_day', directing: 'weekday_boarding' });
  });

  it('returns null when the client sent no selections', () => {
    expect(parseAreaSelections(undefined, allowed)).toBe(null);
    expect(parseAreaSelections([], allowed)).toBe(null);
    expect(parseAreaSelections('weekend_day', allowed)).toBe(null);
  });

  it("refuses a format the operator withdrew — it was never on the applicant's screen", () => {
    expect(
      parseAreaSelections([{ slug: 'acting', key: 'full_time_boarding' }], new Set(['weekend_day'])),
    ).toBe('invalid');
  });

  it('refuses a key nobody created', () => {
    expect(parseAreaSelections([{ slug: 'acting', key: 'evening_class' }], allowed)).toBe('invalid');
    expect(parseAreaSelections([{ slug: 'acting', key: '' }], allowed)).toBe('invalid');
  });

  it('refuses a blank slug and a duplicated area', () => {
    expect(parseAreaSelections([{ slug: '', key: 'weekend_day' }], allowed)).toBe('invalid');
    expect(
      parseAreaSelections(
        [
          { slug: 'acting', key: 'weekend_day' },
          { slug: 'acting', key: 'weekday_day' },
        ],
        allowed,
      ),
    ).toBe('invalid');
  });

  it('trims the key so a padded client payload still prices', () => {
    expect(parseAreaSelections([{ slug: 'acting', key: ' weekend_day ' }], allowed)).toEqual({
      acting: 'weekend_day',
    });
  });
});

describe('pricingStructureFor', () => {
  it('is identity without money, in the operator order', () => {
    const structure = pricingStructureFor(LAUNCH);
    expect(structure.map((s) => s.key)).toEqual(KEYS);
    expect(Object.keys(structure[0]).sort()).toEqual(['key', 'label', 'note', 'sort_order']);
  });

  it('matches what the application endpoint would accept', () => {
    const withdrawn = LAUNCH.map((f) => (f.key === 'weekday_day' ? { ...f, is_active: false } : f));
    const structure = pricingStructureFor(withdrawn).map((s) => s.key);
    for (const key of activeFormatKeys(withdrawn)) expect(structure).toContain(key);
    expect(structure).not.toContain('weekday_day');
  });
});
