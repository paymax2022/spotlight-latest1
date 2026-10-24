/**
 * Server-side pricing for Film Academy area options.
 *
 * Pure and total: every invalid input yields `{ ok: false, error }`, never a
 * throw. Prices are whole naira integers taken ONLY from the option rows
 * supplied by the caller; nothing on a client-supplied selection is trusted.
 */

export type OptionRow = {
  id: string;
  area_slug: string;
  label: string;
  duration_label: string | null;
  price_no_boarding_ngn: number;
  price_with_boarding_ngn: number | null;
  is_active: boolean;
};

export type Selection = { area: string; option_id: string; boarding: boolean };

export type PricedSelection = {
  area_slug: string;
  option_id: string;
  label: string;
  duration_label: string | null;
  boarding: boolean;
  price_ngn: number;
};

export type PriceResult =
  | { ok: true; priced: PricedSelection[]; total_ngn: number }
  | { ok: false; error: string };

const fail = (error: string): PriceResult => ({ ok: false, error });

/** A billable price: a safe whole-naira integer strictly greater than zero. */
const isNaira = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;

export function priceSelections(
  selections: Selection[],
  options: OptionRow[],
  max: number,
): PriceResult {
  try {
    if (!Array.isArray(selections) || selections.length === 0) {
      return fail("Select at least one area option.");
    }
    if (!Array.isArray(options)) return fail("Area options are unavailable.");
    if (selections.length > max) {
      return fail(`You can select at most ${max} area option${max === 1 ? "" : "s"}.`);
    }

    const byId = new Map(options.map((o) => [o.id, o]));
    const seenAreas = new Set<string>();
    const priced: PricedSelection[] = [];
    let total = 0;

    for (const sel of selections) {
      if (!sel || typeof sel.area !== "string" || typeof sel.option_id !== "string") {
        return fail("One of the selected options is invalid.");
      }
      if (seenAreas.has(sel.area)) {
        return fail("Only one option can be selected per area.");
      }
      seenAreas.add(sel.area);

      const row = byId.get(sel.option_id);
      if (!row || row.area_slug !== sel.area) {
        return fail("One of the selected options does not exist for that area.");
      }
      if (!row.is_active) {
        return fail(`The option "${row.label}" is no longer available.`);
      }

      // The ROW must be validly priced before any of it is quoted: a positive
      // no-boarding price, and a with-boarding price that is absent or at least
      // as high. Zero is never "free" — a zero tuition total falls back to the
      // batch fee in the tuition services — so a zero-priced row is treated as
      // not available. The DB CHECKs enforce the same rule; this is the
      // fail-closed guard for rows that predate them.
      if (
        !isNaira(row.price_no_boarding_ngn) ||
        (row.price_with_boarding_ngn !== null &&
          (!isNaira(row.price_with_boarding_ngn) ||
            row.price_with_boarding_ngn < row.price_no_boarding_ngn))
      ) {
        return fail(`The option "${row.label}" is not available. Please contact support.`);
      }

      const boarding = sel.boarding === true;
      const price = boarding ? row.price_with_boarding_ngn : row.price_no_boarding_ngn;
      if (boarding && price === null) {
        return fail(`Boarding is not available for "${row.label}".`);
      }
      if (!isNaira(price)) {
        return fail(`The option "${row.label}" is not available. Please contact support.`);
      }

      priced.push({
        area_slug: row.area_slug,
        option_id: row.id,
        label: row.label,
        duration_label: row.duration_label,
        boarding,
        price_ngn: price,
      });
      total += price;
    }

    if (!Number.isSafeInteger(total)) return fail("The total could not be calculated.");
    return { ok: true, priced, total_ngn: total };
  } catch {
    return fail("We could not price your selection. Please try again.");
  }
}
