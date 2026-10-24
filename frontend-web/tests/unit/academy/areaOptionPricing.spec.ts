import { describe, expect, it } from "vitest";
import {
  priceSelections,
  type OptionRow,
  type Selection,
} from "@/server/services/academy/areaOptionPricing";

const opt = (over: Partial<OptionRow> & { id: string }): OptionRow => ({
  area_slug: "acting",
  label: "Weekend",
  duration_label: "6 weeks",
  price_no_boarding_ngn: 100000,
  price_with_boarding_ngn: 150000,
  is_active: true,
  ...over,
});

const options: OptionRow[] = [
  opt({ id: "a1" }),
  opt({ id: "d1", area_slug: "directing", price_no_boarding_ngn: 200000, price_with_boarding_ngn: null }),
  opt({ id: "x1", area_slug: "editing", is_active: false }),
  opt({ id: "e1", area_slug: "editing", price_no_boarding_ngn: 50000, price_with_boarding_ngn: 80000 }),
];

describe("priceSelections", () => {
  it("prices without boarding", () => {
    const r = priceSelections([{ area: "acting", option_id: "a1", boarding: false }], options, 3);
    expect(r).toMatchObject({ ok: true, total_ngn: 100000 });
  });
  it("prices with boarding", () => {
    const r = priceSelections([{ area: "acting", option_id: "a1", boarding: true }], options, 3);
    expect(r).toMatchObject({ ok: true, total_ngn: 150000 });
    if (r.ok) expect(r.priced[0]).toMatchObject({ boarding: true, price_ngn: 150000, label: "Weekend" });
  });
  it("sums two areas", () => {
    const r = priceSelections(
      [
        { area: "acting", option_id: "a1", boarding: true },
        { area: "directing", option_id: "d1", boarding: false },
      ],
      options,
      3,
    );
    expect(r).toMatchObject({ ok: true, total_ngn: 350000 });
  });
  it("rejects boarding when price_with_boarding_ngn is null", () => {
    expect(priceSelections([{ area: "directing", option_id: "d1", boarding: true }], options, 3).ok).toBe(false);
  });
  it("rejects option from another area", () => {
    expect(priceSelections([{ area: "directing", option_id: "a1", boarding: false }], options, 3).ok).toBe(false);
  });
  it("rejects inactive option", () => {
    expect(priceSelections([{ area: "editing", option_id: "x1", boarding: false }], options, 3).ok).toBe(false);
  });
  it("rejects unknown option id", () => {
    expect(priceSelections([{ area: "acting", option_id: "nope", boarding: false }], options, 3).ok).toBe(false);
  });
  it("rejects duplicate area", () => {
    const sel: Selection[] = [
      { area: "acting", option_id: "a1", boarding: false },
      { area: "acting", option_id: "a1", boarding: true },
    ];
    expect(priceSelections(sel, options, 3).ok).toBe(false);
  });
  it("rejects more than max", () => {
    const sel: Selection[] = [
      { area: "acting", option_id: "a1", boarding: false },
      { area: "directing", option_id: "d1", boarding: false },
    ];
    expect(priceSelections(sel, options, 1).ok).toBe(false);
  });
  it("rejects empty selections", () => {
    expect(priceSelections([], options, 3).ok).toBe(false);
  });
  it("ignores any price field on the selection", () => {
    const sel = [{ area: "acting", option_id: "a1", boarding: false, price_ngn: 1 }] as unknown as Selection[];
    expect(priceSelections(sel, options, 3)).toMatchObject({ ok: true, total_ngn: 100000 });
  });
  it("fails on non-integer or negative option prices and never throws", () => {
    const bad = [opt({ id: "b1", price_no_boarding_ngn: 10.5 }), opt({ id: "b2", area_slug: "x", price_no_boarding_ngn: -1 })];
    expect(priceSelections([{ area: "acting", option_id: "b1", boarding: false }], bad, 3).ok).toBe(false);
    expect(priceSelections([{ area: "x", option_id: "b2", boarding: false }], bad, 3).ok).toBe(false);
    expect(priceSelections(null as unknown as Selection[], options, 3).ok).toBe(false);
  });
  it("rejects a zero-priced option as not available (zero tuition would bill the batch fee)", () => {
    const zero = [opt({ id: "z1", price_no_boarding_ngn: 0, price_with_boarding_ngn: 150000 })];
    const r = priceSelections([{ area: "acting", option_id: "z1", boarding: false }], zero, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not available/i);
    // The row itself is invalid, so even its non-zero boarding price is refused.
    expect(priceSelections([{ area: "acting", option_id: "z1", boarding: true }], zero, 3).ok).toBe(false);
  });
  it("rejects a zero with-boarding price as not available", () => {
    const zero = [opt({ id: "z2", price_no_boarding_ngn: 100000, price_with_boarding_ngn: 0 })];
    const r = priceSelections([{ area: "acting", option_id: "z2", boarding: true }], zero, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not available/i);
  });
  it("rejects an inverted pair (with-boarding below no-boarding) as not available", () => {
    const inverted = [opt({ id: "i1", price_no_boarding_ngn: 100000, price_with_boarding_ngn: 90000 })];
    expect(priceSelections([{ area: "acting", option_id: "i1", boarding: true }], inverted, 3).ok).toBe(false);
    expect(priceSelections([{ area: "acting", option_id: "i1", boarding: false }], inverted, 3).ok).toBe(false);
  });
});
