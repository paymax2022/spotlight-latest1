// Where an Open Mic applicant actually is, worked out from one server answer.
//
// The phone should not decide this from three endpoints that each disagree about
// what "Open Mic" means, and it must not invent a stage the server did not
// sanction: `GET /api/open-mic/me/eligibility` already ranks the conditions in
// the order a reviewer would recognise (approved? beat published? window open?
// song already in?), so `deriveStage` follows exactly that order and nothing
// else. Capability is kept separate from stage on purpose — `canSubmitSong` is
// the server's word, so an artist whose window closed mid-way sees the song they
// already handed in *and* a disabled upload, rather than a stage that quietly
// promises more than the API will allow.
//
// Pure module: no `expo`, no `react-native`, no network. Every branch is under
// `tests/unit/openmic/state.spec.ts`.

import { isPlayableSongStatus } from './constants';
import type { OpenMicBeat, OpenMicEligibility, OpenMicSubmissionSummary, OpenMicWindow } from './types';

export type OpenMicStage =
  /** No answer yet. */
  | { kind: 'loading' }
  /** 401: the flow is per-applicant and there is no anonymous view of it. */
  | { kind: 'sign_in_required' }
  /** A request failed, or the body was not an eligibility verdict. */
  | { kind: 'failed' }
  /** This contest is not an Open Mic edition the API recognises. */
  | { kind: 'unavailable' }
  /** Nothing approved yet and no beat published: wait on both. */
  | { kind: 'approval_pending'; beat: OpenMicBeat | null }
  /** Approved, but the admin has not published a beat, so there is nothing to make a song over. */
  | { kind: 'awaiting_beat' }
  /** The beat is here and playable/downloadable; the upload unlocks at approval. */
  | { kind: 'preview_only'; beat: OpenMicBeat }
  /** Approved and a beat exists, but the submission window does not cover now. */
  | { kind: 'window_closed'; beat: OpenMicBeat; window: OpenMicWindow; submission: OpenMicSubmissionSummary | null }
  /** Everything is in place and no song has been handed in yet. */
  | { kind: 'ready_to_upload'; beat: OpenMicBeat; submission: OpenMicSubmissionSummary | null }
  /** Bytes are stored but the submission is still `draft` — voters cannot hear it until it is submitted. */
  | { kind: 'needs_submit'; beat: OpenMicBeat; submission: OpenMicSubmissionSummary }
  /** A song is on record and playable by voters. */
  | { kind: 'song_live'; beat: OpenMicBeat; submission: OpenMicSubmissionSummary };

export type StageInput = {
  eligibility: OpenMicEligibility | null;
  loading?: boolean;
  /** Which failure the request ran into, so the screen can name the fix. */
  error?: 'auth' | 'not_found' | 'other' | null;
};

export function deriveStage(input: StageInput): OpenMicStage {
  if (input.eligibility === null || input.eligibility === undefined) {
    if (input.loading) return { kind: 'loading' };
    if (input.error === 'auth') return { kind: 'sign_in_required' };
    if (input.error === 'not_found') return { kind: 'unavailable' };
    return { kind: 'failed' };
  }

  const eligibility = input.eligibility;
  if (eligibility.reason === 'no_contest') return { kind: 'unavailable' };

  // A song already on record outranks the window: closing a window must not
  // erase the entry an artist already handed in, or hide the link they share.
  const submission = eligibility.submission;
  if (submission?.hasSong) {
    // A beat can be unpublished after songs are already on record; the stage
    // needs a shape either way, so fall back to an empty beat rather than
    // asserting a non-null the server never promised.
    const beat = eligibility.beat ?? EMPTY_BEAT;
    if (submission.status === 'draft') return { kind: 'needs_submit', beat, submission };
    return { kind: 'song_live', beat, submission };
  }

  if (!eligibility.beat) {
    return eligibility.reason === 'not_approved'
      ? { kind: 'approval_pending', beat: null }
      : { kind: 'awaiting_beat' };
  }

  if (eligibility.reason === 'not_approved') return { kind: 'preview_only', beat: eligibility.beat };
  if (eligibility.reason === 'window_closed') {
    return { kind: 'window_closed', beat: eligibility.beat, window: eligibility.window, submission: null };
  }
  return { kind: 'ready_to_upload', beat: eligibility.beat, submission: null };
}

/**
 * A `song_live` stage whose submission has no beat row (an edition whose beat was
 * unpublished after songs went live) still needs a shape, not a crash.
 */
const EMPTY_BEAT: OpenMicBeat = {
  id: '',
  title: '',
  genre: '',
  producerCredit: '',
  usageRules: '',
  requiresPaidEntry: false,
  previewUrl: null,
  downloadUrl: null,
};

/** May this applicant download the beat file at all? */
export function canDownloadBeat(eligibility: OpenMicEligibility | null): boolean {
  return !!eligibility?.beat?.downloadUrl;
}

/** May this applicant play the beat inside the app? */
export function canPreviewBeat(eligibility: OpenMicEligibility | null): boolean {
  return !!eligibility?.beat?.previewUrl;
}

/**
 * The server's own gate, untouched. Upload, replace and submit all hang on it;
 * the phone never decides eligibility from a status string it remembered.
 */
export function canSubmitSong(eligibility: OpenMicEligibility | null): boolean {
  return eligibility?.canSubmitSong === true;
}

/**
 * The artist's own song address when a stage says voters can hear it.
 *
 * Returned exactly as the server issued it — the root-relative
 * `/api/open-mic/songs/<id>` a local build produces, or an absolute CDN address
 * if one is configured — because this module cannot know the origin a phone
 * reaches. A screen passes it to `mediaUrl()`. Requiring an `http` scheme here
 * would reject the localhost case outright and leave every applicant without a
 * player, which is the bug an earlier draft of this function had.
 */
export function playableSongUrl(stage: OpenMicStage): string | null {
  if (stage.kind !== 'song_live') return null;
  const url = stage.submission.playableUrl;
  if (!url) return null;
  // Belt and braces against the status list: the eligibility route only fills
  // the address for a row that has bytes, and a `draft` never reaches this stage.
  return isPlayableSongStatus(stage.submission.status) ? url : null;
}

/**
 * Bytes the server already holds for a `draft` row.
 *
 * Returning the key lets the artist finish an interrupted hand-in (fill the form,
 * press submit) without re-uploading a 20 MB file — but only when the server said
 * the bytes are there, which is why this reads the eligibility answer rather than
 * the phone's own memory of the last upload.
 */
export function resumableObjectKey(stage: OpenMicStage): string | null {
  if (stage.kind !== 'needs_submit') return null;
  return stage.submission.objectKey;
}

/**
 * One heading + one body per stage. Copy lives here rather than in the screen so
 * the wording a test asserts is the wording a user reads, and so the two cards
 * (beat, song) never disagree about the same stage.
 */
export function describeStage(stage: OpenMicStage): { title: string; body: string } {
  switch (stage.kind) {
    case 'loading':
      return { title: 'Checking your entry', body: 'Loading your beat and submission status…' };
    case 'sign_in_required':
      return {
        title: 'Sign in to continue',
        body: 'Your beat and your song slot belong to your account, so sign in with the account you registered with.',
      };
    case 'failed':
      return {
        title: 'Couldn’t load Open Mic',
        body: 'We could not read your entry status. Pull down to try again — if it keeps failing, your registration may still be processing.',
      };
    case 'unavailable':
      return {
        title: 'No Open Mic edition running',
        body: 'This contest has no published Open Mic beat yet, so there is nothing to download or hand in here.',
      };
    case 'approval_pending':
      return {
        title: 'Waiting on approval',
        body: 'Once the review team approves your entry, your official beat appears here and you can start recording.',
      };
    case 'awaiting_beat':
      return {
        title: 'Your beat is on the way',
        body: 'You are approved for this edition. The producer has not published the official beat yet — it will appear here the moment it does.',
      };
    case 'preview_only':
      return {
        title: 'Your beat is here',
        body: 'Listen and download it now. The song upload unlocks as soon as your application is approved, so you can have the track ready.',
      };
    case 'window_closed':
      return {
        title: stage.window.open ? 'Hand-in time' : 'Hand-ins are closed',
        body: windowBody(stage.window),
      };
    case 'ready_to_upload':
      return {
        title: 'Make your song, hand it in',
        body: 'Record over the official beat, then upload the finished MP3. Voters hear it the moment you submit.',
      };
    case 'needs_submit':
      return {
        title: 'Uploaded — one step left',
        body: 'Your file is stored but no voter can hear it until you submit the song. Finish the details below and press submit.',
      };
    case 'song_live':
      return {
        title: 'Your song is live',
        body: 'Voters can play it now. Share it so your fanbase can vote.',
      };
  }
}

function windowBody(window: OpenMicWindow): string {
  const starts = formatStamp(window.startsAt);
  const ends = formatStamp(window.endsAt);
  if (window.reason === 'before_start' && starts) return `Hand-ins open ${starts}. You can download the beat and prepare your track until then.`;
  if (window.reason === 'after_end' && ends) return `Hand-ins closed ${ends}. To change your song, contact the organiser with your reference number.`;
  if (window.reason === 'no_window_configured') return 'The organiser has not set a hand-in window for this edition, so uploads are paused. You can still download the beat.';
  return 'Hand-ins are paused for now. You can still download the beat and prepare your track.';
}

/** `en-NG, medium date + short time`, falling back to the raw stamp. */
export function formatStamp(iso: string | null): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** Minutes and seconds of the beat, e.g. `2:35`, or '' when undeclared. */
export function beatDurationLabel(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
