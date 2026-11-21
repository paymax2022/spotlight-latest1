// Every Open Mic call the phone makes, in one place, against the observed
// server contract (`frontend-web/app/api/open-mic/…`).
//
// Two rules this file keeps:
//   1. The paths are passed unprefixed. These routes live on the Next.js web
//      app, not on the Go `/api/v1` connect host, so they ride the shared `api`
//      axios instance exactly like the registration client does.
//   2. A failure carries the server's own reason code, never a paraphrase. The
//      eligibility gate answers 403 with `{ code, reason, source,
//      submissionOpensAt, submissionDeadline }` precisely so a client can say
//      "hand-ins open 1 December" instead of "upload failed" — see
//      `src/server/openmic/song-upload-request.ts`.
//
// Nothing here imports `expo` or `react-native`: moving the bytes is
// `transport.ts`'s job, and keeping this pure means the request/response
// mapping is unit-testable.

import { api } from '@/api/client';
import { parseEligibility, type EligibilityReason, type OpenMicEligibility } from './types';

/** Which failure the caller ran into, so the screen can name the fix. */
export type OpenMicFailureKind = 'auth' | 'not_found' | 'eligibility' | 'validation' | 'other';

export class OpenMicError extends Error {
  readonly kind: OpenMicFailureKind;
  readonly status?: number;
  /** The gate's reason code when the server sent one. */
  readonly reason?: string;
  readonly opensAt?: string | null;
  readonly deadline?: string | null;
  /** Field messages from `createSubmission`'s `errors` object. */
  readonly fields: Record<string, string>;

  constructor(
    message: string,
    kind: OpenMicFailureKind,
    extra: {
      status?: number;
      reason?: string;
      opensAt?: string | null;
      deadline?: string | null;
      fields?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = 'OpenMicError';
    this.kind = kind;
    this.status = extra.status;
    this.reason = extra.reason;
    this.opensAt = extra.opensAt ?? null;
    this.deadline = extra.deadline ?? null;
    this.fields = extra.fields ?? {};
  }
}

function bodyOf(error: unknown): Record<string, unknown> | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function messageOf(error: unknown, fallback: string): string {
  const body = bodyOf(error);
  const fromBody = body?.error ?? body?.message;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  const fromError = (error as { message?: unknown })?.message;
  if (typeof fromError === 'string' && fromError.trim()) return fromError.trim();
  return fallback;
}

function fieldErrors(body: Record<string, unknown> | null): Record<string, string> {
  const raw = body?.errors;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** Turn anything thrown by axios (or us) into an `OpenMicError`. */
export function toOpenMicError(error: unknown, fallback: string): OpenMicError {
  if (error instanceof OpenMicError) return error;
  const status = Number((error as { response?: { status?: number } })?.response?.status) || undefined;
  const body = bodyOf(error);
  const message = messageOf(error, fallback);
  const fields = fieldErrors(body);

  if (status === 401) return new OpenMicError(message, 'auth', { status, fields });
  if (status === 404) return new OpenMicError(message, 'not_found', { status, fields });

  const reason = typeof body?.reason === 'string' ? body.reason : typeof body?.code === 'string' ? body.code : undefined;
  if (status === 403 && reason) {
    return new OpenMicError(message, 'eligibility', {
      status,
      reason,
      opensAt: typeof body?.submissionOpensAt === 'string' ? body.submissionOpensAt : null,
      deadline: typeof body?.submissionDeadline === 'string' ? body.submissionDeadline : null,
      fields,
    });
  }
  if (Object.keys(fields).length > 0) {
    return new OpenMicError(message, 'validation', { status, reason, fields });
  }
  return new OpenMicError(message, 'other', { status, reason, fields });
}

/**
 * `GET /api/open-mic/me/eligibility`.
 *
 * Read-only and self-scoped: the account in the bearer token is the only
 * applicant this can describe. Rejects with `not_found` when the slug is not an
 * Open Mic edition the server recognises, which is what keeps the phone from
 * guessing the identity rule itself.
 */
export async function getOpenMicEligibility(contestSlug: string): Promise<OpenMicEligibility> {
  const slug = String(contestSlug || '').trim();
  if (!slug) throw new OpenMicError('contestSlug is required', 'validation');
  try {
    const res = await api.get(`/api/open-mic/me/eligibility`, { params: { contestSlug: slug } });
    const parsed = parseEligibility(res.data);
    if (!parsed) throw new OpenMicError('The server did not return an eligibility verdict.', 'other');
    return parsed;
  } catch (error) {
    throw toOpenMicError(error, 'Could not load your Open Mic status.');
  }
}

/**
 * The consented beat download: it records the hand-over in `beat_download_logs`
 * (which the admin panel reads) and hands back the beat's own URLs.
 *
 * The file bytes are fetched from the public reader URL afterwards — this POST
 * is the permission + the record, not the transfer.
 */
export async function logBeatDownload(input: {
  contestSlug: string;
  artistName: string;
  artistEmail?: string;
  termsAccepted: boolean;
  paidAccessConfirmed?: boolean;
}): Promise<void> {
  const slug = encodeURIComponent(String(input.contestSlug || '').trim());
  if (!slug) throw new OpenMicError('contestSlug is required', 'validation');
  try {
    await api.post(`/api/open-mic/contests/${slug}/beat/download`, {
      artistName: input.artistName,
      artistEmail: input.artistEmail ?? '',
      termsAccepted: input.termsAccepted === true,
      paidAccessConfirmed: input.paidAccessConfirmed === true,
    });
  } catch (error) {
    throw toOpenMicError(error, 'Could not record your beat download.');
  }
}

/** What the server told the client to do with the bytes. */
export interface SongUploadTicket {
  /** `presigned` = PUT these bytes to `uploadUrl`; `direct` = multipart POST to us. */
  mode: 'presigned' | 'direct';
  uploadUrl: string;
  method: 'PUT' | 'POST';
  /** Multipart field name, only in `direct` mode. */
  fieldName: string | null;
  /** Headers the transport must send (presigned carries the signed Content-Type). */
  headers: Record<string, string>;
  /**
   * Echoed back from the request, because the direct sink re-derives the object
   * key from the slug it reads as a multipart field — a transport that only had
   * `objectKey` could not fill that field in honestly.
   */
  contestSlug: string;
  submissionId: string;
  objectKey: string;
  readerUrl: string;
  maxBytes: number;
  /** Root-relative in `direct` mode, absolute in `presigned` mode. */
  needsOrigin: boolean;
}

/**
 * Ask permission to hand in a song. The server decides the transport (`mode`)
 * from its own storage config, so the client branches on the answer instead of
 * assuming a bucket exists.
 */
export async function requestSongUploadTicket(input: {
  contestSlug: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}): Promise<SongUploadTicket> {
  try {
    const res = await api.post('/api/open-mic/uploads/presign', {
      contestSlug: input.contestSlug,
      fileName: input.fileName,
      fileSize: input.fileSize,
      contentType: input.contentType,
    });
    const body = (res.data ?? {}) as Record<string, unknown>;
    const upload = (body.upload ?? {}) as Record<string, unknown>;
    const submissionId = String(upload.submissionId ?? '').trim();
    const objectKey = String(upload.objectKey ?? '').trim();
    const uploadUrl = String(upload.uploadUrl ?? '').trim();
    if (!submissionId || !objectKey || !uploadUrl) {
      throw new OpenMicError('The upload ticket came back incomplete.', 'other');
    }
    const mode = String(upload.mode ?? 'presigned').toLowerCase() === 'direct' ? 'direct' : 'presigned';
    const rawHeaders = (upload.headers ?? {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value === 'string') headers[key] = value;
    }
    return {
      mode,
      uploadUrl,
      method: String(upload.method ?? (mode === 'direct' ? 'POST' : 'PUT')).toUpperCase() === 'POST' ? 'POST' : 'PUT',
      fieldName: upload.fieldName == null ? null : String(upload.fieldName),
      headers,
      contestSlug: input.contestSlug,
      submissionId,
      objectKey,
      readerUrl: String(upload.readerUrl ?? ''),
      maxBytes: Number(upload.maxBytes ?? 0) || 0,
      needsOrigin: uploadUrl.startsWith('/'),
    };
  } catch (error) {
    throw toOpenMicError(error, 'Could not prepare your song upload.');
  }
}

/** "The bytes landed — book the slot." */
export async function confirmSongUpload(input: {
  contestSlug: string;
  submissionId: string;
  objectKey: string;
  fileName: string;
}): Promise<{ readerUrl: string; status: string }> {
  try {
    const res = await api.post('/api/open-mic/uploads/complete', {
      contestSlug: input.contestSlug,
      submissionId: input.submissionId,
      objectKey: input.objectKey,
      fileName: input.fileName,
    });
    const upload = ((res.data ?? {}) as Record<string, unknown>).upload as Record<string, unknown> | undefined;
    return {
      readerUrl: String(upload?.readerUrl ?? ''),
      status: String(upload?.status ?? '').toLowerCase(),
    };
  } catch (error) {
    throw toOpenMicError(error, 'Could not confirm your song upload.');
  }
}

/** The hand-in form, as `POST /api/open-mic/submissions` receives it. */
export interface OpenMicSongForm {
  contestSlug: string;
  stageName: string;
  /**
   * The name on the applicant's identity record. The route passes it to
   * `resolveApplicantUserId` as the fallback the stage name is *not* — so an
   * artist whose stage name differs from their legal name is matched by the
   * registration, not by a name collision.
   */
  realName?: string;
  email: string;
  country: string;
  state: string;
  lga: string;
  songTitle: string;
  genre?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  facebookHandle?: string;
  xHandle?: string;
  submissionId: string;
  songObjectKey: string;
  songFileName?: string;
  officialBeatConfirmed: boolean;
  ownershipConfirmed: boolean;
  noUnauthorizedSamplesConfirmed: boolean;
}

/**
 * Submit the finished song. This is the step that makes the entry visible to
 * voters: `complete` only stores the bytes and books a `draft` row.
 *
 * `songObjectKey` is the key the server issued, and it re-derives and compares
 * it — so the value is carried through untouched rather than rebuilt here.
 */
export async function submitOpenMicSong(form: OpenMicSongForm): Promise<{ submissionId: string }> {
  try {
    const res = await api.post('/api/open-mic/submissions', {
      ...form,
      cleanVersionAvailable: true,
      finaleAvailabilityConfirmed: true,
    });
    const body = (res.data ?? {}) as Record<string, unknown>;
    if (body.success === false) {
      throw new OpenMicError(messageOf({ response: { data: body } }, 'Song submission failed.'), 'validation', {
        fields: fieldErrors(body),
      });
    }
    const submission = body.submission as Record<string, unknown> | undefined;
    return { submissionId: String(submission?.id ?? body.submissionId ?? form.submissionId) };
  } catch (error) {
    throw toOpenMicError(error, 'Could not submit your song.');
  }
}

/** Reason codes the gate can return, re-exported so a screen can switch on them. */
export type { EligibilityReason };
