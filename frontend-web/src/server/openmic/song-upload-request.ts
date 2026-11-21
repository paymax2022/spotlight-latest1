/**
 * Shared request-side rules for handing in a song.
 *
 * Three routes need the same three decisions — is this file an mp3 we accept, is
 * it small enough, and is this artist allowed to upload right now — and they used
 * to disagree: the presign route validated the client's declared size and type,
 * while `complete` trusted the key it was handed and the direct-upload route did
 * not exist. A multipart sink and a presigned PUT must not have different rules,
 * because a client picks one based on server config rather than on semantics.
 *
 * `guard*` functions are pure so a node-env test can exercise them without a
 * running server; the response helpers are the thin HTTP layer on top.
 */
import { NextResponse } from 'next/server';
import { MAX_SONG_BYTES, SONG_EXTENSION, buildSongObjectKey, isUUID, songContestRef, songReaderUrl } from '@/src/features/openmic/song-storage';
import { eligibilityForbiddenBody, type EligibilityVerdict } from './submission-eligibility';

export type GuardResult = { ok: true } | { ok: false; message: string };

/**
 * The file *name* decides what we will serve back, and only the extension is
 * trusted — the same SEC-007 posture as `app/api/registration/uploads/route.ts`:
 * a client-supplied `file.type` of "image/svg+xml" on a file named song.mp3 must
 * not become the response Content-Type.
 */
export function guardSongFileName(fileName: string): GuardResult {
  const name = String(fileName || '').trim();
  if (!name) return { ok: false, message: 'fileName is required' };
  if (!name.toLowerCase().endsWith(SONG_EXTENSION)) {
    return { ok: false, message: `Only ${SONG_EXTENSION} uploads are allowed` };
  }
  return { ok: true };
}

export function guardSongContentType(contentType: string): GuardResult {
  const value = String(contentType || '').toLowerCase().split(';')[0].trim();
  // Browsers and RN file pickers disagree on whether an mp3 is audio/mpeg or
  // audio/mp3; the historic route demanded audio/mp3 exactly. Both are mp3, and
  // neither is what we serve — the extension map decides that.
  if (value !== 'audio/mp3' && value !== 'audio/mpeg') {
    return { ok: false, message: 'File type must be audio/mp3' };
  }
  return { ok: true };
}

export function guardSongSize(fileSize: number | string | null | undefined): GuardResult {
  const bytes = Number(fileSize);
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, message: 'fileSize is required' };
  if (bytes > MAX_SONG_BYTES) return { ok: false, message: 'MP3 file must be 50MB or less' };
  return { ok: true };
}

export function isSubmissionId(value: string): boolean {
  return isUUID(String(value || '').trim());
}

export function songObjectKeyFor(input: {
  contest: { slug?: string | null; id?: string | null };
  artistUserId: string;
  submissionId: string;
}): string {
  return buildSongObjectKey({
    contestRef: songContestRef(input.contest),
    artistUserId: input.artistUserId,
    submissionId: input.submissionId,
  });
}

/**
 * 403 with the machine-readable reason and the dates, so a client can render
 * "waiting on approval" or "opens 1 December" instead of a generic failure. This
 * is the whole point of routing every upload path through one gate: the answer is
 * the same shape whichever route produced it. The wording lives in the gate
 * (`eligibilityForbiddenBody`); this only turns it into an HTTP response.
 */
export function eligibilityForbiddenResponse(verdict: EligibilityVerdict) {
  const body = eligibilityForbiddenBody(verdict);
  return NextResponse.json(
    {
      success: false,
      error: body.message,
      code: body.reason,
      reason: body.reason,
      source: body.source,
      submissionOpensAt: body.submissionOpensAt,
      submissionDeadline: body.submissionDeadline,
    },
    { status: 403 },
  );
}

/**
 * The upload descriptor both modes share. `mode` is the only field a client
 * branches on: 'presigned' means PUT these bytes to `uploadUrl`, 'direct' means
 * POST them as multipart to the server, which will hold the file locally.
 */
export function songUploadDescriptor(input: {
  contest: { slug?: string | null; id?: string | null };
  artistUserId: string;
  submissionId: string;
}) {
  const objectKey = songObjectKeyFor(input);
  const base = {
    contestId: songContestRef(input.contest),
    artistId: input.artistUserId,
    submissionId: input.submissionId,
    objectKey,
    readerUrl: songReaderUrl(input.submissionId),
    maxBytes: MAX_SONG_BYTES,
    extension: SONG_EXTENSION,
  };
  return base;
}
