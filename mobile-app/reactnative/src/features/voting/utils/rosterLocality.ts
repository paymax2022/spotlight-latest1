// Locality on the voting roster: what a voter reads on a card, and how the grid is
// narrowed to a village.
//
// Locality for a local contest is display + filter — never eligibility. Nobody is
// blocked from entering or voting over which quarter they are from, so this module's
// only job is to say where someone is from, most specific part first, and to narrow a
// list to the locality a voter cares about.
//
// Two deliberate choices:
//
//   * the filter runs on rows already in hand. Go's roster endpoint answers the whole
//     roster and ignores query parameters (only /connect/villages reads them), so a
//     locality sent as a query string would look wired while doing nothing. That is the
//     same trap the search box on this screen fell into;
//   * the option lists come from the roster, not from the bundled state -> LGA table.
//     A panel that offers a ward with nobody in it returns an empty grid, and the voter
//     reads that as "nobody from here entered" rather than "this contest has nobody from
//     here".

import type { Contestant } from '../types/voting.types';

export interface LocalityFilter {
  state?: string;
  lga?: string;
  village?: string;
}

export type LocalityLevel = keyof LocalityFilter;

export interface LocalityParts {
  state?: string;
  lga?: string;
  village?: string;
}

const part = (value: unknown): string => String(value ?? '').trim();

/** Most specific first, blanks dropped so no line ends in a stray separator. */
export function localityLine(c: LocalityParts): string {
  return [part(c.village), part(c.lga), part(c.state)].filter(Boolean).join(' · ');
}

/**
 * The card line: the two most specific parts the row actually has.
 *
 * A grid card is half the screen wide and already carries a category, so three
 * locality parts push the name onto a second line. On a local contest the village is
 * the interesting part, and the LGA is what tells you the village is real.
 */
export function cardLocality(c: LocalityParts): string {
  const village = part(c.village);
  const lga = part(c.lga);
  const state = part(c.state);
  if (village) return [village, lga].filter(Boolean).join(' · ');
  return [lga, state].filter(Boolean).join(' · ');
}

/**
 * Distinct values at one level, narrowed by the levels above it that are already
 * chosen. Empty strings never become a choice: a contestant who skipped the village
 * field is not from a ward called "".
 */
export function localityChoices(
  rows: Pick<Contestant, 'state' | 'lga' | 'village'>[],
  level: LocalityLevel,
  filter: LocalityFilter,
): string[] {
  const above = rows.filter((row) => {
    if (level === 'lga' || level === 'village') {
      if (part(filter.state) && part(row.state) !== part(filter.state)) return false;
    }
    if (level === 'village') {
      if (part(filter.lga) && part(row.lga) !== part(filter.lga)) return false;
    }
    return true;
  });

  const seen = new Set<string>();
  for (const row of above) {
    const value = part(row[level]);
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Is any locality level on? Drives the active-filter chip and the clear button. */
export function hasActiveLocality(filter: LocalityFilter): boolean {
  return Boolean(part(filter.state) || part(filter.lga) || part(filter.village));
}

const LEVELS_BELOW: Record<LocalityLevel, LocalityLevel[]> = {
  state: ['lga', 'village'],
  lga: ['village'],
  village: [],
};

/**
 * Apply one tap in the filter panel: pick a level (or tap the value already on to clear
 * it) and drop every level below it.
 *
 * Dropping the levels below is not tidiness. A grid left filtered on village
 * "Ogbendida" while the state moves to Lagos matches nothing, and the voter sees an
 * empty list with no visible reason for it. Cleared levels are removed rather than set
 * to '', so a caller can spread the result straight into state and the chip row reads
 * "nothing selected" instead of "something is selected, name unknown".
 */
export function selectLocality(current: LocalityFilter, level: LocalityLevel, value: string): LocalityFilter {
  const next: LocalityFilter = { ...current };
  const wasSelected = part(next[level]) === part(value);
  if (wasSelected) delete next[level];
  else next[level] = value;
  for (const below of LEVELS_BELOW[level]) delete next[below];
  return next;
}

/**
 * Apply the locality panel and the search box to the roster.
 *
 * A level left blank is not a filter. An uncurated contestant (no village) still shows
 * under its LGA — "Onitsha North" means the LGA, and someone who never typed a quarter
 * is still from it.
 */
export function filterRoster(
  rows: Contestant[],
  filter: LocalityFilter,
  search: string,
): Contestant[] {
  const state = part(filter.state);
  const lga = part(filter.lga);
  const village = part(filter.village);
  const needle = part(search).toLowerCase();

  return rows.filter((row) => {
    if (state && part(row.state) !== state) return false;
    if (lga && part(row.lga) !== lga) return false;
    if (village && part(row.village) !== village) return false;
    if (needle) {
      const haystack = [row.name, row.stageName, row.category]
        .map((v) => part(v).toLowerCase())
        .join(' ');
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}
