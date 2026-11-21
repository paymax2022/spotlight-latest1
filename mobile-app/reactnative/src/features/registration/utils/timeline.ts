// One "Status history" list out of two sources that used to be unaware of
// each other.
//
// WHY THIS EXISTS
// The list was the review log — draft, submitted, approved — and stopped. For an
// Open Mic artist the real workflow continues past approval (download the beat,
// record, upload, hand in, get the decision), and those milestones live in a
// different read entirely (`/applications/:id/workflow`). Showing only half of
// an applicant's progress is what made the page feel finished when it was not.
//
// THE RULES
//   newest first, both sources interleaved by timestamp;
//   a review verdict outranks a step recorded in the same second, because the
//   verdict is the thing the applicant is waiting for;
//   an event whose timestamp will not parse is dropped rather than rendered as
//   "Invalid Date";
//   a workflow step with `at: null` is a real decision with no recorded time —
//   it stays, at the top, and the screen simply prints no date for it.
import { statusLabel } from './status-labels';
import type { RegistrationStatusEvent, WorkflowStep } from '../types/registration.types';

export interface TimelineEntry {
  key: string;
  title: string;
  /** null = the step is real but the server recorded no time for it. */
  at: string | null;
  note?: string;
  source: 'status' | 'open_mic';
}

function parseable(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : raw;
}

/**
 * Merge the review log and the Open Mic milestones.
 *
 * Either side may be missing (a non-Open-Mic application has no steps; a step
 * read that has not answered yet has none either), so both arguments are
 * optional and an absent one contributes nothing.
 */
export function mergeStatusTimeline(
  events?: RegistrationStatusEvent[],
  steps?: WorkflowStep[],
): TimelineEntry[] {
  const entries: Array<TimelineEntry & { sortMs: number }> = [];

  for (const event of events ?? []) {
    const at = parseable(event.createdAt);
    // A status event is written with a timestamp by definition; one without a
    // usable value is corrupt data, not an undated milestone.
    if (!at) continue;
    entries.push({
      key: `status-${event.id}`,
      title: statusLabel(event.newStatus),
      at,
      ...(event.note ? { note: event.note } : {}),
      source: 'status',
      sortMs: Date.parse(at),
    });
  }

  for (const step of steps ?? []) {
    const raw = String(step.at ?? '').trim();
    let at: string | null = null;
    let sortMs = Number.POSITIVE_INFINITY;
    if (raw === '') {
      at = null;
    } else {
      const parsed = parseable(raw);
      // Unparseable is corrupt: drop it, exactly as with a status event.
      if (!parsed) continue;
      at = parsed;
      sortMs = Date.parse(parsed);
    }
    entries.push({
      key: `open-mic-${step.id}`,
      title: step.label,
      at,
      ...(step.note ? { note: step.note } : {}),
      source: 'open_mic',
      sortMs,
    });
  }

  entries.sort((a, b) => {
    if (a.sortMs !== b.sortMs) return b.sortMs - a.sortMs;
    if (a.source !== b.source) return a.source === 'status' ? -1 : 1;
    return 0;
  });

  return entries.map(({ sortMs: _sortMs, ...entry }) => entry);
}
