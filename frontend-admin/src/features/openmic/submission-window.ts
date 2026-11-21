/**
 * When artists are allowed to hand in a song, in the admin console's words.
 *
 * The authoritative rule lives in frontend-web —
 * src/server/openmic/submission-window.ts — and every server-side gate
 * (presign, the direct-upload sink, createSubmission) reads it there. Mirrored
 * here, not imported: frontend-admin and frontend-web are separately deployed
 * Next apps, each `@/*` maps inside itself and there is no shared/ directory at
 * the repo root, so this console cannot reach that module (same constraint and
 * same treatment as ../openmic/beat-url.ts). If the rule changes, change BOTH
 * copies; this one is pinned by tests/admin/openmic/submission-window.test.ts
 * against the table frontend-web pins in tests/unit/openmic/submission-window.test.ts.
 *
 * Why the console cares at all: the rule is strict by default. An edition with
 * no dates configured is CLOSED, not open — so an operator who publishes an
 * edition, uploads a beat and never sets the window has produced an application
 * flow that approves artists and then refuses every one of their songs. The
 * server says so with a 403 that carries `reason`; this module turns the same
 * verdict into the sentence the editor shows before that happens.
 */

export type SubmissionWindowLike = {
  status?: string | null;
  submissionStartAt?: string | null;
  submissionEndAt?: string | null;
};

export type SubmissionWindowReason = 'open' | 'no_window_configured' | 'before_start' | 'after_end';

export type SubmissionWindowVerdict = {
  open: boolean;
  reason: SubmissionWindowReason;
  startsAt: string | null;
  endsAt: string | null;
};

/** The contest status that force-opens submissions regardless of dates. */
const FORCED_OPEN_STATUS = 'submission_open';

export function describeSubmissionWindow(
  contest: SubmissionWindowLike | null | undefined,
  nowMs: number = Date.now(),
): SubmissionWindowVerdict {
  const startsAt = contest?.submissionStartAt ? String(contest.submissionStartAt) : null;
  const endsAt = contest?.submissionEndAt ? String(contest.submissionEndAt) : null;

  if (!contest) {
    return { open: false, reason: 'no_window_configured', startsAt: null, endsAt: null };
  }
  if (String(contest.status || '').trim().toLowerCase() === FORCED_OPEN_STATUS) {
    return { open: true, reason: 'open', startsAt, endsAt };
  }

  const startMs = startsAt ? Date.parse(startsAt) : Number.NaN;
  const endMs = endsAt ? Date.parse(endsAt) : Number.NaN;

  if (Number.isNaN(startMs) && Number.isNaN(endMs)) {
    return { open: false, reason: 'no_window_configured', startsAt, endsAt };
  }
  if (!Number.isNaN(startMs) && nowMs < startMs) {
    return { open: false, reason: 'before_start', startsAt, endsAt };
  }
  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return { open: false, reason: 'after_end', startsAt, endsAt };
  }
  return { open: true, reason: 'open', startsAt, endsAt };
}

export function isSubmissionWindowOpen(
  contest: SubmissionWindowLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return describeSubmissionWindow(contest, nowMs).open;
}

/**
 * `YYYY-MM-DD HH:MM` in the operator's own timezone. Deliberately not
 * `toLocaleString`: the notice is asserted in tests, and a locale-formatted
 * string differs between machines (and between Lagos and CI) in ways that have
 * nothing to do with the rule being displayed.
 */
export function formatWindowStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type SubmissionWindowNotice = {
  /** `warn` is the amber tone; `ok` the green one. Same two states the console uses elsewhere. */
  tone: 'ok' | 'warn';
  text: string;
};

/**
 * The one-line verdict an editor shows above the date fields. Every branch has
 * to say something an operator can act on: `no_window_configured` in particular
 * must read as CLOSED, because that is what the server will do with it.
 */
export function submissionWindowNotice(
  contest: SubmissionWindowLike | null | undefined,
  nowMs: number = Date.now(),
): SubmissionWindowNotice {
  const v = describeSubmissionWindow(contest, nowMs);
  const forcedOpen = String(contest?.status || '').trim().toLowerCase() === FORCED_OPEN_STATUS;

  if (v.reason === 'no_window_configured') {
    return {
      tone: 'warn',
      text: 'No submission window is configured, so artists cannot hand in a song — every upload is refused. Set the dates below, or set this edition\'s status to submission_open.',
    };
  }
  if (v.reason === 'before_start') {
    const stamp = v.startsAt ? formatWindowStamp(v.startsAt) : 'its start date';
    return { tone: 'warn', text: `Hand-ins are closed until ${stamp}.` };
  }
  if (v.reason === 'after_end') {
    const stamp = v.endsAt ? formatWindowStamp(v.endsAt) : 'its end date';
    return { tone: 'warn', text: `Hand-ins closed on ${stamp}. Songs already submitted stay below for review.` };
  }
  if (forcedOpen) {
    return { tone: 'ok', text: 'Status is submission_open, so hand-ins are accepted whatever the dates say.' };
  }
  const until = v.endsAt ? ` until ${formatWindowStamp(v.endsAt)}` : '';
  return { tone: 'ok', text: `Hand-ins are open${until}.` };
}

/**
 * A stored bound in the shape a `<input type="datetime-local">` needs:
 * `YYYY-MM-DDTHH:MM`, no seconds, no zone suffix.
 *
 * The server holds whatever the operator last saved — an ISO string with `Z`
 * from a seeded edition, or the zone-less local string a datetime-local picker
 * produces — and a picker only shows a value it can parse. Passing a `Z` string
 * straight through leaves the field blank, which reads as "no window set" and
 * then the next save erases the real date. So a zone-aware value is converted to
 * the operator's local wall clock, and a zone-less one is trimmed and kept
 * exactly as it was: re-parsing `2026-11-20T18:00` as UTC and re-printing it
 * local would shift an already-correct date by the offset.
 */
export function toDateTimeLocalInput(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes('T')) return raw;
  const zoneAware = /(?:Z|z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (!zoneAware) return raw.slice(0, 16);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
