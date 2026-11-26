// The Open Mic screen's side of the network: what stage the artist is at, how the
// beat gets handed over, and how a song gets handed in.
//
// Three kinds of hook, three different failure policies, on purpose:
//
//   • `useOpenMicStage` is load-bearing. Its errors are the UI's content, so it
//     maps them onto the stage union instead of swallowing them.
//   • `useBeatHandover` and `useSongHandin` are user-initiated actions. Each
//     reports which step it is on and passes the server's own refusal sentence
//     through, and neither claims a file was saved or a song published before the
//     call that says so has returned.
//   • `useSongPrefill` is a convenience. A failure there must not stop anyone
//     from uploading, so it degrades to an empty form.
//
// `retry: false` everywhere: a 401 from these endpoints means "you are not signed
// in as the applicant", which a retry cannot fix, and a 403 from the eligibility
// gate is a verdict rather than a hiccup.
//
// This is the only Open Mic module that touches `expo` and the query cache, which
// is why every rule worth asserting lives in the pure siblings and the unit tests
// stop there.

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase';
import { getDraft, listApplications } from '../registration/api/registration.api';
import type { RegistrationDraft } from '../registration/types/registration.types';
import {
  OpenMicError,
  confirmSongUpload,
  getOpenMicEligibility,
  logBeatDownload,
  requestSongUploadTicket,
  submitOpenMicSong,
  type OpenMicSongForm,
} from './api';
import { MAX_SONG_BYTES, SONG_CONTENT_TYPE, SONG_EXTENSION, looksLikeOpenMicSlug } from './constants';
import { isPlayableHttpUrl } from './absolute-url';
import { asDownload, asPreview, mediaUrl } from './media';
import {
  identityFromUser,
  pickOpenMicApplication,
  prefillFromRegistrationFormData,
  withPrefillDefaults,
  type SongFormPrefill,
} from './prefill';
import {
  canSubmitSong,
  deriveStage,
  describeStage,
  formatStamp,
  playableSongUrl,
  shouldShowSongUpload,
  type OpenMicStage,
} from './state';
import {
  downloadBeat,
  shareSavedBeat,
  statSongFile,
  uploadSongBytes,
  type LocalSongFile,
  type SavedBeat,
} from './transport';
import type { OpenMicBeat, OpenMicEligibility } from './types';

export type StageErrorKind = 'auth' | 'not_found' | 'other';

/** Narrow an unknown throw onto the three verdicts `deriveStage` understands. */
export function stageErrorKind(error: unknown): StageErrorKind {
  if (error instanceof OpenMicError) {
    if (error.kind === 'auth') return 'auth';
    if (error.kind === 'not_found') return 'not_found';
    return 'other';
  }
  const status = Number((error as { response?: { status?: number } })?.response?.status) || 0;
  if (status === 401) return 'auth';
  if (status === 404) return 'not_found';
  return 'other';
}

/** `stage` is the only shape a screen should branch on; never re-derive it inline. */
export function useOpenMicStage(contestSlug: string) {
  const query = useQuery<OpenMicEligibility, unknown>({
    queryKey: ['openmic', 'eligibility', contestSlug],
    queryFn: () => getOpenMicEligibility(contestSlug),
    enabled: !!contestSlug,
    retry: false,
    staleTime: 20_000,
  });

  const stage = useMemo<OpenMicStage>(
    () =>
      deriveStage({
        eligibility: query.data ?? null,
        loading: !!contestSlug && query.isPending,
        error: query.isError ? stageErrorKind(query.error) : null,
      }),
    [contestSlug, query.data, query.isPending, query.isError, query.error],
  );

  const refresh = useCallback(() => query.refetch(), [query]);

  return {
    stage,
    eligibility: query.data ?? null,
    error: query.error ?? null,
    refresh,
    refreshing: query.isFetching,
  };
}

/** The signed-in applicant, for the two fields no application can supply. */
export function useArtistIdentity() {
  const query = useQuery({
    queryKey: ['openmic', 'identity'],
    queryFn: async () => {
      const { data } = await createSupabaseClient().auth.getSession();
      return identityFromUser(data.session?.user);
    },
    retry: false,
    staleTime: 60_000,
  });
  return {
    userId: query.data?.userId ?? '',
    email: query.data?.email ?? '',
    displayName: query.data?.displayName ?? '',
    signedIn: Boolean(query.data?.userId),
  };
}

/**
 * Everything a screen needs to show the Open Mic phase, from one server answer.
 *
 * The hand-in screen and the application status screen render the same stage
 * machine, so the derivation lives here once: which cards are on screen, the
 * copy that explains the stage, the address the player may actually use, and
 * the identity the beat download is logged against. A screen keeps only its own
 * pull-to-refresh, because that is a property of the scroll view, not of Open Mic.
 */
export interface OpenMicPhase {
  stage: OpenMicStage;
  eligibility: OpenMicEligibility | null;
  copy: { title: string; body: string };
  /** The server's own upload gate, passed through untouched. */
  allowed: boolean;
  /** Playable in a native player, or null — never an address that will 404. */
  playableUrl: string | null;
  /** The name the beat download is recorded against. */
  artistName: string;
  artistEmail: string;
  showBeat: boolean;
  showUpload: boolean;
  /** True when the screen was opened without the edition it needs. */
  missingSlug: boolean;
  refresh: () => Promise<unknown>;
  refreshing: boolean;
}

export function useOpenMicPhase(contestSlug: string): OpenMicPhase {
  const { stage, eligibility, refresh, refreshing } = useOpenMicStage(contestSlug);
  const identity = useArtistIdentity();

  // The address is the server's, the origin is this device's, and only an
  // http(s) result may reach a native player.
  const resolved = mediaUrl(playableSongUrl(stage));
  const playable = resolved && isPlayableHttpUrl(resolved) ? resolved : null;

  return {
    stage,
    eligibility,
    copy: describeStage(stage),
    allowed: canSubmitSong(eligibility),
    playableUrl: playable,
    artistName: identity.displayName || identity.email,
    artistEmail: identity.email,
    showBeat: 'beat' in stage && stage.beat !== null,
    showUpload: shouldShowSongUpload(stage),
    missingSlug: !contestSlug,
    refresh,
    refreshing,
  };
}

/**
 * Answers the artist gave when they registered, offered as defaults.
 *
 * Both reads are optional: an account that applied on the website, or one whose
 * application lives in a plane this list does not return, simply gets a blank
 * form. Blocking an upload on a prefill lookup would be the wrong trade.
 */
export function useSongPrefill(contestSlug: string) {
  const query = useQuery<SongFormPrefill>({
    queryKey: ['openmic', 'prefill', contestSlug],
    queryFn: () => fetchSongPrefill(contestSlug),
    enabled: !!contestSlug,
    retry: false,
    staleTime: 60_000,
  });
  // `loaded` is what the form needs, not `refreshing`: while the read is still
  // outstanding the entry's answers are unknown, and a box filled from the account
  // in that window is a box the entry can no longer reach. A failed read counts as
  // loaded — nothing else is coming, so the account is the best answer available.
  const loaded = !contestSlug || query.isSuccess || query.isError;
  return {
    prefill: query.data ?? withPrefillDefaults(null),
    refreshing: query.isFetching,
    loaded,
  };
}

export async function fetchSongPrefill(contestSlug: string): Promise<SongFormPrefill> {
  try {
    const drafts: RegistrationDraft[] = await listApplications();
    const mine = pickOpenMicApplication(drafts, contestSlug, looksLikeOpenMicSlug);
    if (!mine) return withPrefillDefaults(null);
    // A list row does not promise the answers, only the identity fields, so the
    // draft itself is fetched when the row arrives empty.
    let form = mine.formData;
    if (!form || Object.keys(form).length === 0) {
      const loaded = await getDraft(mine.id);
      form = loaded?.draft?.formData;
    }
    return withPrefillDefaults(prefillFromRegistrationFormData(form));
  } catch {
    return withPrefillDefaults(null);
  }
}

export type BeatHandoverPhase = 'idle' | 'recording' | 'downloading' | 'sharing' | 'saved' | 'error';

export interface BeatHandover {
  phase: BeatHandoverPhase;
  busy: boolean;
  saved: SavedBeat | null;
  /** True when the OS share sheet actually took the file. */
  shared: boolean;
  message: string;
  error: string;
  /** Beat bytes for the player, resolved on this device, attachment flag off. */
  playableUrl: string | null;
  /** A file may leave the app only when the organiser allowed it. */
  canSave: boolean;
  /** The address the save uses, so the UI can describe what it is fetching. */
  saveUrl: string | null;
  start: () => Promise<boolean>;
  reset: () => void;
}

/**
 * The consented beat hand-over: record it, fetch it, then offer it to the OS.
 *
 * The order is not interchangeable. Recording first means the admin's download
 * log reflects a download the artist then completed — and if the transfer fails
 * the consent record still exists, which is the honest direction for an audit
 * table. It also matches the web applicant page, which posts consent before it
 * transfers anything.
 *
 * `paidAccessConfirmed` is only ever true when the artist ticked the box, and the
 * box only renders when the edition says `requiresPaidEntry`: a client that
 * asserted it would be making a statement about money it cannot see.
 */
export function useBeatHandover(input: {
  contestSlug: string;
  beat: OpenMicBeat | null;
  artistName: string;
  artistEmail?: string;
  termsAccepted: boolean;
  paidAccessConfirmed?: boolean;
}): BeatHandover {
  const [phase, setPhase] = useState<BeatHandoverPhase>('idle');
  const [saved, setSaved] = useState<SavedBeat | null>(null);
  const [shared, setShared] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { beat, contestSlug, artistName, artistEmail, termsAccepted, paidAccessConfirmed } = input;

  const playableUrl = asPreview(beat?.previewUrl ?? beat?.downloadUrl);
  // The eligibility route already nulls `downloadUrl` when the organiser switched
  // downloads off or marked the beat preview-only, so a present URL here is
  // permission, not just a path.
  const saveUrl = asDownload(beat?.downloadUrl);
  const canSave = Boolean(saveUrl);

  const reset = useCallback(() => {
    setPhase('idle');
    setSaved(null);
    setShared(false);
    setMessage('');
    setError('');
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!beat) {
      setError('This edition has no official beat yet.');
      setPhase('error');
      return false;
    }
    if (!artistName.trim()) {
      setError('Add your stage name so the organiser can match the download to your entry.');
      setPhase('error');
      return false;
    }
    if (!termsAccepted) {
      setError('Accept the beat usage rules before downloading.');
      setPhase('error');
      return false;
    }
    if (!saveUrl) {
      setError('This beat is preview-only — the organiser has not allowed the file to be downloaded.');
      setPhase('error');
      return false;
    }

    setError('');
    setSaved(null);
    setShared(false);
    try {
      setPhase('recording');
      setMessage('Recording your consent…');
      await logBeatDownload({
        contestSlug,
        artistName: artistName.trim(),
        artistEmail: artistEmail?.trim() || undefined,
        termsAccepted: true,
        paidAccessConfirmed: paidAccessConfirmed === true,
      });

      setPhase('downloading');
      setMessage('Downloading the official beat…');
      const result = await downloadBeat(saveUrl, beat.title || 'official-beat');
      setSaved(result);

      if (result.uri) {
        setPhase('sharing');
        const handed = await shareSavedBeat(result.uri);
        setShared(handed);
        setMessage(
          handed
            ? `Saved as ${result.filename}. Choose “Save to Files”, then record your verse over it.`
            : `Saved on this device as ${result.filename}.`,
        );
      } else {
        setMessage(`Downloaded ${result.filename} — check your browser downloads.`);
      }
      setPhase('saved');
      return true;
    } catch (caught) {
      setPhase('error');
      setMessage('');
      setError(describeFailure(caught));
      return false;
    }
  }, [artistEmail, artistName, beat, contestSlug, paidAccessConfirmed, saveUrl, termsAccepted]);

  return {
    phase,
    busy: phase === 'recording' || phase === 'downloading' || phase === 'sharing',
    saved,
    shared,
    message,
    error,
    playableUrl,
    canSave,
    saveUrl,
    start,
    reset,
  };
}

/** The form the artist completes; everything else the hand-in needs is server-issued. */
export type SongHandinForm = Omit<
  OpenMicSongForm,
  'contestSlug' | 'submissionId' | 'songObjectKey' | 'songFileName'
>;

export type SongHandinPhase =
  | 'idle'
  | 'picking'
  | 'ready'
  | 'requesting'
  | 'uploading'
  | 'confirming'
  | 'submitting'
  | 'done'
  | 'failed';

export interface SongHandinResume {
  submissionId: string;
  objectKey: string;
}

export interface SongHandin {
  phase: SongHandinPhase;
  busy: boolean;
  file: LocalSongFile | null;
  message: string;
  error: string;
  /** Field messages from the server's own `errors` object. */
  fieldErrors: Record<string, string>;
  maxBytes: number;
  pick: () => Promise<LocalSongFile | null>;
  clear: () => void;
  handin: (
    form: SongHandinForm,
    resume?: SongHandinResume | null,
  ) => Promise<{ submissionId: string } | null>;
}

/**
 * Pick → measure → ask permission → move bytes → book the slot → submit.
 *
 * The four server calls are not optional and not reorderable: `presign` decides
 * the transport and refuses an ineligible applicant, the transport must not start
 * before that answer, `complete` is what proves the bytes exist, and only
 * `POST /submissions` makes the song voter-facing. A hand-in that stops at
 * `complete` leaves a `draft` row the artist can see but no voter can hear —
 * which is why `phase` names each step and why `resume` exists: when the server
 * already holds the bytes, the artist finishes the form without uploading a
 * 20 MB file twice.
 */
export function useSongHandin(input: { contestSlug: string }): SongHandin {
  const [phase, setPhase] = useState<SongHandinPhase>('idle');
  const [file, setFile] = useState<LocalSongFile | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearErrors = useCallback(() => {
    setError('');
    setFieldErrors({});
  }, []);

  const pick = useCallback(async () => {
    clearErrors();
    setPhase('picking');
    try {
      // The registration picker already knows how to ask for audio, how to map an
      // `.mp3` accept hint onto a MIME glob, and what to say when permission is
      // denied, so the song uses it instead of a second copy of that logic.
      const { pickFileForField } = require('../registration/utils/filePicker') as typeof import('../registration/utils/filePicker');
      const picked = await pickFileForField(SONG_EXTENSION);
      if (!picked) {
        setPhase(file ? 'ready' : 'idle');
        return null;
      }
      const measured = await statSongFile(picked.uri, picked.name);
      if (measured.size > MAX_SONG_BYTES) {
        setPhase('failed');
        setError(
          `${picked.name} is ${(measured.size / (1024 * 1024)).toFixed(1)} MB. ` +
            `The limit is ${Math.round(MAX_SONG_BYTES / (1024 * 1024))} MB — export a smaller MP3.`,
        );
        return null;
      }
      setFile(measured);
      setPhase('ready');
      return measured;
    } catch (caught) {
      setPhase('failed');
      setError(describeFailure(caught));
      return null;
    }
  }, [clearErrors, file]);

  const clear = useCallback(() => {
    setFile(null);
    clearErrors();
    setMessage('');
    setPhase('idle');
  }, [clearErrors]);

  const handin = useCallback(
    async (form: SongHandinForm, resume?: SongHandinResume | null) => {
      clearErrors();

      const resuming = Boolean(resume?.objectKey && resume?.submissionId);
      if (!resuming && !file) {
        setPhase('failed');
        setError('Choose the finished MP3 you want to hand in.');
        return null;
      }

      try {
        let submissionId = resuming ? String(resume?.submissionId) : '';
        let objectKey = resuming ? String(resume?.objectKey) : '';

        if (!resuming && file) {
          setPhase('requesting');
          setMessage('Checking you are cleared to hand in…');
          const ticket = await requestSongUploadTicket({
            contestSlug: input.contestSlug,
            fileName: file.name,
            fileSize: file.size,
            contentType: SONG_CONTENT_TYPE,
          });
          submissionId = ticket.submissionId;
          objectKey = ticket.objectKey;

          setPhase('uploading');
          setMessage(`Uploading ${file.name}…`);
          await uploadSongBytes(ticket, file);

          setPhase('confirming');
          setMessage('Confirming the file arrived…');
          await confirmSongUpload({
            contestSlug: input.contestSlug,
            submissionId,
            objectKey,
            fileName: file.name,
          });
        }

        setPhase('submitting');
        setMessage(resuming ? 'Submitting your song…' : 'Publishing your song for voting…');
        const result = await submitOpenMicSong({
          ...form,
          contestSlug: input.contestSlug,
          submissionId,
          songObjectKey: objectKey,
          songFileName: file?.name,
        });
        setPhase('done');
        setMessage('Your song is live. Voters can play it now.');
        return result;
      } catch (caught) {
        setPhase('failed');
        setMessage('');
        setError(describeFailure(caught));
        setFieldErrors(caught instanceof OpenMicError ? caught.fields : {});
        return null;
      }
    },
    [clearErrors, file, input.contestSlug],
  );

  return {
    phase,
    busy:
      phase === 'picking' || phase === 'requesting' || phase === 'uploading' ||
      phase === 'confirming' || phase === 'submitting',
    file,
    message,
    error,
    fieldErrors,
    maxBytes: MAX_SONG_BYTES,
    pick,
    clear,
    handin,
  };
}

/**
 * The sentence the artist reads.
 *
 * An eligibility 403 carries dates, and "hand-ins are closed" without them sends
 * the artist to support instead of telling them when to come back.
 */
function describeFailure(error: unknown): string {
  if (error instanceof OpenMicError) {
    const opens = formatStamp(String(error.opensAt ?? ''));
    const closes = formatStamp(String(error.deadline ?? ''));
    const dates =
      error.reason === 'window_closed' && (opens || closes)
        ? ` ${opens ? `Hand-ins open ${opens}.` : `The deadline was ${closes}.`}`
        : '';
    return `${error.message}${dates}`;
  }
  const fromError = (error as { message?: unknown })?.message;
  if (typeof fromError === 'string' && fromError.trim()) return fromError.trim();
  return 'Something went wrong. Please try again.';
}
