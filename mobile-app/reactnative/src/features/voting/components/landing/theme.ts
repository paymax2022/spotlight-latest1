// The voting landing screen's own palette, derived from the Spotlight mark.
//
// The app tokens carry the product chrome (purple/blue on a pale surface); they
// do not carry what a talent show actually looks like. This file adds the three
// things this one screen needs and nowhere else does:
//   • the night a stage sits in (deep violet-black),
//   • the gold a spotlight casts (CTAs on dark, rank one, live accents),
//   • the spectrum inside the Spotlight logo itself (amber → magenta → violet →
//     cyan), used ONLY for the light beam so the signature stays a signature.
//
// Gold on white fails contrast as text, so `goldText` is the darkened,
// accessible variant used for eyebrows and links on paper surfaces.
import { Colors } from '@/constants/tokens';
import { CONTEST_SECTIONS, contestInSection } from '../../utils/contestSections';
import type { Contest, ContestStatus } from '../../types/voting.types';

export const Stage = {
  night:     '#150629',
  nightDeep: '#0C0319',
  nightSoft: '#251044',
  nightCard: '#1B0A33',

  gold:      '#FFC53D',
  goldDeep:  '#F0A500',
  goldInk:   '#3B2600',
  /** Gold dark enough to read as text on the app's paper background. */
  goldText:  '#8A5200',
  goldWash:  'rgba(255,197,61,0.14)',

  magenta:   '#F4237B',
  violet:    '#5B21C9',
  cyan:      '#22B8F0',

  paper:     Colors.background,
  card:      Colors.surfaceContainerLowest,
  ink:       Colors.onSurface,
  muted:     Colors.onSurfaceVariant,
  hairline:  Colors.surfaceContainerHigh,
  white:     '#FFFFFF',
} as const;

/** The beam's own gradient — the logo ribbon, thrown as light. */
export const BEAM_COLORS = ['rgba(255,197,61,0.42)', 'rgba(244,35,123,0.18)', 'rgba(91,33,201,0)'] as const;

/**
 * The screen is a phone composition: at browser widths the same rhythm would
 * stretch a shelf of 250px posters into a sparse row and push a section's
 * "ALL CONTESTS" link a hand-width away from its title. Past this width the
 * page keeps its column and centres it, while the hero's artwork still bleeds
 * edge to edge so the stage stays cinematic.
 */
export const CONTENT_MAX = 720;

/** The centred column every section shares. */
export const contentColumn = {
  width: '100%',
  maxWidth: CONTENT_MAX,
  alignSelf: 'center',
} as const;

/**
 * What the contest is, in one word, without inventing a taxonomy the backend
 * does not send. The Connect contest payload has no category field, so the
 * honest label is the admin-controlled section its own title matches (Open Mic,
 * Talent Hunt…) — and `null` when it matches nothing, so callers hide the chip
 * instead of printing an empty one.
 */
export function contestLabel(contest?: Contest | null): string | null {
  if (!contest) return null;
  const own = (contest.category ?? '').trim();
  if (own) return own;
  const section = CONTEST_SECTIONS.find((s) => contestInSection(contest, s));
  return section?.title ?? null;
}

/** The badge word for a contest's lifecycle, in this screen's voice. */
export function statusKicker(status: ContestStatus | undefined): string {
  switch (status) {
    case 'LIVE':     return 'LIVE VOTING';
    case 'UPCOMING': return 'VOTING OPENS SOON';
    case 'PAUSED':   return 'VOTING PAUSED';
    default:         return 'VOTING CLOSED';
  }
}

/**
 * A deadline short enough for a card corner. Returns null when the contest has
 * no configured close date — the caller hides the row rather than guessing.
 */
export function deadlineLabel(endsAt?: string): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= Date.now()) return 'Voting ended';
  return `Ends ${end.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`;
}

/** True voter counts only: no votes configured means the number is not shown. */
export function hasVotes(contest: Pick<Contest, 'totalVotes'>): boolean {
  return typeof contest.totalVotes === 'number' && contest.totalVotes > 0;
}
