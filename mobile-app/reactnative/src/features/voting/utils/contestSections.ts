// The named contest sections behind the landing row's Open Mic / Talent Hunt /
// Rising Star tiles.
//
// These are VIEWS OVER EXISTING CONTESTS, not new screens and not new data. The
// Go voting module lists contests filtered only by ?status= (see
// backend/internal/connect/voting/handlers.go — `listContests` reads status and
// limit, nothing else) and its Contest payload carries no category field at all,
// so the client cannot ask the server for "the Open Mic contest". What a section
// therefore matches on is the contest's own name: the title is the one field an
// admin controls when they create it in the competitions console, and this table
// is where that promise is written down.
//
// Dependency-free (no React, no RN) so it is unit-testable under plain node:test,
// exactly like contestFilter.ts, and importable from a screen or a test alike.
import type { Contest } from '../types/voting.types';

export interface ContestSection {
  /** URL token: /voting/contests?section=<id> */
  id: string;
  /** Heading the list screen shows instead of the generic "Contests". */
  title: string;
  /**
   * Lowercased fragments, matched against a contest's title and category.
   * Several per section where the same show is known by more than one name —
   * the seeded talent search is titled "Spotlight Talent Search Season 2" while
   * the brief calls the section Talent Hunt, so both spellings are kept rather
   * than silently showing an empty list for a contest that does exist.
   */
  keywords: string[];
  emptyTitle: string;
  emptyMessage: string;
}

export const CONTEST_SECTIONS: ContestSection[] = [
  {
    id: 'open-mic',
    title: 'Open Mic',
    keywords: ['open mic'],
    emptyTitle: 'No Open Mic contest is running right now…',
    emptyMessage: 'Open Mic editions are published from the competitions console. Pull down to refresh — a live one opens straight here.',
  },
  {
    id: 'talent-hunt',
    title: 'Talent Hunt',
    keywords: ['talent hunt', 'talent search'],
    emptyTitle: 'No Talent Hunt contest is running right now…',
    emptyMessage: 'Auditions for the next season open here as soon as the contest is published. Pull down to refresh.',
  },
  {
    id: 'rising-star',
    title: 'Rising Star',
    keywords: ['rising star'],
    emptyTitle: 'Rising Star is not open yet…',
    emptyMessage:
      'The contest is created in the competitions console: a Rising Star category, the nominees with their photos and talent, the vote price, the prize and the dates. The moment it is live this tile opens it.',
  },
];

/** Resolve a `?section=` token. Unknown or absent tokens are not an error. */
export function sectionFor(id: string | undefined | null): ContestSection | null {
  if (!id) return null;
  return CONTEST_SECTIONS.find((s) => s.id === id) ?? null;
}

/**
 * Collapse to lowercase word fragments so 'Open-Mic', 'open mic' and
 * 'OPEN MIC 2026' all contain the 'open mic' keyword. Non-alphanumerics become
 * single spaces; a leading/trailing space is harmless for `includes`.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function contestInSection(contest: Contest, section: ContestSection): boolean {
  const haystack = `${normalize(contest.title)} ${normalize(contest.category ?? '')}`;
  return section.keywords.some((kw) => haystack.includes(kw));
}

export function filterContestsBySection(contests: Contest[], section: ContestSection | null): Contest[] {
  if (!section) return contests;
  return contests.filter((c) => contestInSection(c, section));
}
