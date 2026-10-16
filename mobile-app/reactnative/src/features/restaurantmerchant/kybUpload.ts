// ── KYB document upload ──────────────────────────────────────────────────────
// Two steps, because the file never travels through our API:
//   1. Ask the backend for a short-lived presigned PUT URL. It chooses the object
//      key — the client cannot pick where the file lands.
//   2. PUT the file straight to R2 with the exact Content-Type the backend bound
//      into the signature, then record the returned key against the KYB record.
//
// The PUT uses plain `fetch`, NOT the app's axios client: that client attaches the
// user's Supabase bearer token to every request, and sending it to a third-party
// host would leak the session. The presigned URL carries its own authorisation.

import { addKYBDocument, presignKYBDocument, USE_MOCK } from './api';
import { kybContentType, kybFileProblem, KYB_MAX_BYTES } from './kybFiles';

export interface KYBPickedFile {
  uri: string;
  name: string;
  size?: number | null;
}

/** Which step failed, so the owner (and Sentry) can tell them apart. */
export type KYBUploadStep = 'validate' | 'read-file' | 'upload' | 'record';

export class KYBUploadError extends Error {
  step: KYBUploadStep;
  status?: number;
  constructor(step: KYBUploadStep, message: string, status?: number) {
    super(message);
    this.name = 'KYBUploadError';
    this.step = step;
    this.status = status;
  }
}

/**
 * Upload a picked file as the outlet's `docType` document and record it. Throws
 * KYBUploadsUnavailableError (from presignKYBDocument) when the server can't sign
 * uploads, and KYBUploadError for every failure after that point.
 */
export async function uploadKYBDocument(outletId: string, docType: string, file: KYBPickedFile): Promise<void> {
  const problem = kybFileProblem(file);
  if (problem) throw new KYBUploadError('validate', problem);
  const contentType = kybContentType(file.name) as string; // non-null: kybFileProblem passed

  if (USE_MOCK) {
    // Offline demo: nothing to upload to. Record a stand-in reference so the rest
    // of the flow (hasCertDoc, submit) behaves like the real thing.
    await addKYBDocument(outletId, docType, `https://mock.invalid/${encodeURIComponent(file.name)}`, file.name);
    return;
  }

  const presigned = await presignKYBDocument(outletId, docType, file.name, contentType);

  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch {
    throw new KYBUploadError('read-file', "We couldn't read that file. Choose it again.");
  }
  // A zero-byte blob uploads "successfully" and then shows the reviewer nothing; the
  // picker's reported size can also be missing or wrong, so check the real bytes.
  if (!blob.size) throw new KYBUploadError('read-file', 'That file looks empty. Choose a different one.');
  if (blob.size > KYB_MAX_BYTES) {
    throw new KYBUploadError('validate', `That file is too large. Keep it under ${KYB_MAX_BYTES / (1024 * 1024)} MB.`);
  }

  let put: Response;
  try {
    put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      // The signature covers this header — a different value fails with 403.
      headers: { 'Content-Type': presigned.contentType },
      body: blob,
    });
  } catch {
    // fetch only rejects when no HTTP response arrived at all (DNS, TLS, reset, timeout).
    throw new KYBUploadError('upload', "The file couldn't be sent. Check your connection and try again.");
  }
  if (!put.ok) {
    throw new KYBUploadError('upload', "Our storage rejected the file. Try again, or paste a link instead.", put.status);
  }

  await addKYBDocument(outletId, docType, presigned.objectKey, file.name);
}
