// The wire shape of `GET /api/open-mic/me/eligibility`, typed on the phone side.
//
// The server returns camelCase and may put `null` in nearly every field, so the
// parsing here is deliberately tolerant: a missing string becomes `''`, a
// missing number becomes `undefined`, and anything that is not an object at all
// parses to `null` so the screen can say "we could not work out your stage"
// instead of crashing on `eligibility.beat.title`.
//
// Pure module — no `expo`, no `react-native` — so `node --test` can exercise
// every variant. `api.ts` is the one that touches the network.

export type EligibilityReason =
  | 'ok'
  | 'no_contest'
  | 'beat_missing'
  | 'not_approved'
  | 'window_closed';

export type EligibilitySource = 'promoted' | 'enrollment' | 'registration' | 'none';

export type SubmissionWindowReason =
  | 'open'
  | 'no_window_configured'
  | 'before_start'
  | 'after_end';

export interface OpenMicBeat {
  id: string;
  title: string;
  genre: string;
  durationSeconds?: number;
  producerCredit: string;
  usageRules: string;
  /**
   * True when this edition gates the beat file behind a paid entry. The
   * download POST is refused unless the caller confirms access, so the checkbox
   * only appears — and the confirmation only gets asserted — when the rule
   * actually exists.
   */
  requiresPaidEntry: boolean;
  /** Root-relative reader path, absolute if the admin configured a CDN. */
  previewUrl: string | null;
  /** Null when the beat is preview-only or downloads are switched off. */
  downloadUrl: string | null;
}

export interface OpenMicSubmissionSummary {
  id: string;
  status: string;
  songTitle: string;
  hasSong: boolean;
  /**
   * The artist's own stored object key, or null when nothing was uploaded yet.
   * A `draft` row that already has bytes can be submitted without re-uploading,
   * which is the only reason a client is allowed to see it.
   */
  objectKey: string | null;
  playableUrl: string | null;
  submittedAt: string | null;
}

export interface OpenMicWindow {
  open: boolean;
  reason: SubmissionWindowReason;
  startsAt: string | null;
  endsAt: string | null;
}

export interface OpenMicEligibility {
  contestId: string;
  contestSlug: string;
  /** The contest's own lifecycle status, e.g. `submission_open`. */
  status: string;
  canSubmitSong: boolean;
  reason: EligibilityReason;
  source: EligibilitySource;
  beat: OpenMicBeat | null;
  window: OpenMicWindow;
  submission: OpenMicSubmissionSummary | null;
}

const REASONS: EligibilityReason[] = ['ok', 'no_contest', 'beat_missing', 'not_approved', 'window_closed'];
const SOURCES: EligibilitySource[] = ['promoted', 'enrollment', 'registration', 'none'];
const WINDOW_REASONS: SubmissionWindowReason[] = ['open', 'no_window_configured', 'before_start', 'after_end'];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const out = typeof value === 'string' ? value.trim() : String(value).trim();
  return out || null;
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const out = text(value).toLowerCase();
  return (allowed as string[]).includes(out) ? (out as T) : fallback;
}

/**
 * A declared number, or `undefined` when the field was never filled in.
 *
 * `Number(null)` is `0` and `Number('')` is `0`, so a bare coercion would turn
 * "the producer did not declare a length" into "the beat is 0 seconds long" —
 * a value a label can render as `0:00`. Absent stays absent.
 */
function number(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const out = Number(value);
  return Number.isFinite(out) ? out : undefined;
}

function parseBeat(raw: Record<string, unknown> | null): OpenMicBeat | null {
  if (!raw) return null;
  return {
    id: text(raw.id),
    title: text(raw.title) || 'Official beat',
    genre: text(raw.genre),
    durationSeconds: number(raw.durationSeconds),
    producerCredit: text(raw.producerCredit),
    usageRules: text(raw.usageRules),
    requiresPaidEntry:
      flag(raw.requiresPaidEntry) || flag(raw.requiresPaidEntryForDownload),
    previewUrl: optionalText(raw.previewUrl),
    downloadUrl: optionalText(raw.downloadUrl),
  };
}

function parseWindow(raw: unknown): OpenMicWindow {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    open: flag(value.open),
    reason: pick(value.reason, WINDOW_REASONS, 'no_window_configured'),
    startsAt: optionalText(value.startsAt),
    endsAt: optionalText(value.endsAt),
  };
}

function parseSubmission(raw: Record<string, unknown> | null): OpenMicSubmissionSummary | null {
  if (!raw) return null;
  return {
    id: text(raw.id),
    status: text(raw.status).toLowerCase(),
    songTitle: text(raw.songTitle),
    hasSong: flag(raw.hasSong),
    objectKey: optionalText(raw.songObjectKey ?? raw.objectKey),
    playableUrl: optionalText(raw.playableUrl),
    submittedAt: optionalText(raw.submittedAt),
  };
}

const VERDICT_FIELDS = [
  'contestId',
  'contestSlug',
  'canSubmitSong',
  'reason',
  'source',
  'beat',
  'window',
  'submission',
];

/**
 * `{ success, eligibility: { … } }` → a typed verdict.
 *
 * A body without an `eligibility` object is not a partial success: it is a
 * server that answered something else entirely, and the caller needs to know
 * that rather than render an empty stage. The bare verdict object is still
 * accepted, because some envelopes hand out the payload already unwrapped — so
 * the test is whether the object carries any field a verdict has, not whether it
 * is nested. An object that carries none parses to null, and the stage machine
 * then says "couldn't load, pull down to retry" instead of the wrong
 * "no Open Mic edition running".
 */
export function parseEligibility(body: unknown): OpenMicEligibility | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as Record<string, unknown>;
  const raw = (envelope.eligibility ?? envelope) as unknown;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!VERDICT_FIELDS.some((key) => value[key] !== undefined)) return null;
  const beat =
    value.beat && typeof value.beat === 'object'
      ? parseBeat(value.beat as Record<string, unknown>)
      : null;
  return {
    contestId: text(value.contestId),
    contestSlug: text(value.contestSlug),
    status: text(value.status),
    canSubmitSong: flag(value.canSubmitSong),
    reason: pick(value.reason, REASONS, 'no_contest'),
    source: pick(value.source, SOURCES, 'none'),
    beat,
    window: parseWindow(value.window),
    submission:
      value.submission && typeof value.submission === 'object'
        ? parseSubmission(value.submission as Record<string, unknown>)
        : null,
  };
}
