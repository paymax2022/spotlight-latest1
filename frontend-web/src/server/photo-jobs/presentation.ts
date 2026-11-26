/**
 * Decides which portrait a promotion should present — and guarantees that
 * deciding never rewrites the one the contestant uploaded (spec §6).
 *
 * This module exists because the code it replaces did the same job by
 * assignment: `supabase-store.ts:1067` wrote the pipeline's output over
 * `form_data['media.photoUrl']`, which was the only pointer to the original
 * upload. Two things went wrong with that. The original became unrecoverable —
 * no asset row, no key, nothing to re-render from — and the value a reader saw
 * stopped telling them which of the two it was. Both are the same defect seen
 * from different ends: one column was asked to be both the input and the output.
 *
 * So the rule here is that nothing in this file can write. It reads the newest
 * job, asks for the published asset when a job is ready, and returns a *mode*
 * for the caller to record. The caller's job is to store that mode next to the
 * untouched original, which is what lets every later surface say "this is the
 * composite" or "this is still the upload" without guessing.
 *
 * The second rule is that a promotion is never held up by a vendor. Only the
 * branch where no job exists yet touches the pipeline, and it enqueues rather
 * than renders: the queue's own ladder, lock and pause-on-exhaust do the work
 * later. An approval that 500s because Cloudinary timed out loses a decision the
 * admin already made; an approval that says "portrait pending" loses nothing.
 */
import { uploadObjectKeyFor } from '@/src/lib/media/asset-source';
import { RENDERED_PHOTO_PREFIXES } from './persist';
import { registerOriginalAndEnqueue } from './registry';
import { getLatestPhotoJob, type PhotoJob } from './job-store';
import { kickDrain, publishedPortraitFor } from './status-read';

export type PhotoMode = 'composite' | 'processing' | 'original' | 'rejected';

/**
 * What a reviewer is looking at, and what to record about it.
 *
 * `photoUrl` is the contract: for `composite` it is the rendered portrait's URL,
 * and in every other mode it is the stored original value, unchanged — so a
 * caller that displays `photoUrl` is never shown a half-finished render and never
 * handed a rewritten blob. The two ids are separate because they name different
 * rows: `originalAssetId` is the immutable upload (the re-render source),
 * `photoAssetId` is the `final` composite that only exists in `composite` mode.
 */
export interface PhotoPresentation {
  mode: PhotoMode;
  photoUrl: string;
  photoAssetId?: string;
  originalAssetId?: string;
  reason?: string;
}

/**
 * Every key a registration has ever used for its photo, oldest first.
 *
 * The order is a compatibility rule, not a preference: rows written while
 * `20260812010000_registration_contestant_seam.sql` was current hold their photo
 * in `media.photoUrl`, and the review path has always read that key. Current
 * forms (`src/features/registration/forms/*.ts`) collect `media.profilePhoto` and
 * `promote_registration_to_contestant()` has read *that* key since
 * `20260812020001:78`. Checking only the legacy names — which is what the block
 * this file replaces did — meant a photo job was never created for any
 * application submitted through a form in the repo today. One function now owns
 * the answer, so the submit hook and the review hook cannot disagree about which
 * field is the applicant's photograph.
 */
const PHOTO_KEYS = ['media.photoUrl', 'media.headshotUrl', 'media.profilePhoto'] as const;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `registry` reports why it skipped a render; a reviewer needs the same fact in
 *  the application's own record rather than only in a log line. Anything with a
 *  vendor message attached (`notFetchable: …`, `relative: …`) is passed through
 *  verbatim — rewriting it here would lose the variable name the operator needs. */
function skipReason(skipped: string): string {
  if (skipped === 'noTemplate') return 'This contest has no active photo template yet — the original photograph is presented';
  if (skipped === 'assetWriteFailed') return 'The original photograph could not be recorded in the asset ledger';
  if (skipped === 'enqueueFailed') return 'The portrait render could not be queued';
  if (skipped === 'noPhoto') return 'noPhoto';
  return skipped;
}

/**
 * Is this value something we *made* rather than something the contestant took?
 *
 * A rendered portrait is stored under one of `RENDERED_PHOTO_PREFIXES`, either
 * as a bare object key or as the public URL derived from that key; both
 * spellings name output. This is a shape test rather than a provenance record
 * because the superseded review path left no provenance: it overwrote
 * `media.photoUrl` with the composite, so a legacy row holds a rendered image
 * under the very key that used to hold the upload, while `media.profilePhoto`
 * still holds the upload. Registering the composite as the "original" would
 * make every later re-render start from a face already pasted onto a frame, and
 * would burn the one asset row that exists to be the immutable source.
 */
const RENDERED_KEY = new RegExp(`(?:^|/)contestants/(?:${RENDERED_PHOTO_PREFIXES.join('|')})/`);

function isRenderedPortrait(value: string): boolean {
  return RENDERED_KEY.test(value);
}

/**
 * The applicant's photograph, exactly as the registration row stores it.
 *
 * `PHOTO_KEYS` order stays the scan order — legacy first, which is what the
 * review path has always presented — but the scan is not the answer. The
 * answer is a ranking of what the scan collects, and the ranking exists for the
 * overwrite problem described above:
 *
 *  1. A candidate that names an object in our own bucket wins. The upload route
 *     writes originals there and rendered output lives under a different
 *     prefix, so "is this ours" is the strongest provenance claim obtainable
 *     from a stored string — and it is what recovers the untouched photograph
 *     for a legacy row whose `media.photoUrl` holds a vendor cutout.
 *  2. Anything matching a rendered prefix is dropped before ranking at all, so
 *     a row that holds *only* output is reported as having no photograph rather
 *     than as having one it can re-render from.
 *
 * The mobile client stores the whole upload response (`{fileName, previewUrl,
 * storageKey}`) while the web wizard stores the `previewUrl` route;
 * `validation.ts:41` documents both shapes as valid and `contestant-photo.ts`
 * reads them the same way, so the scan normalises them here rather than
 * pretending one shape exists.
 *
 * A genuine limit is worth naming: an external URL we did not mint — the
 * Cloudinary cutout the old no-template fallback returned, for instance — is
 * indistinguishable by shape from an external original. Such a value is still
 * presented when nothing of ours exists, because showing a reviewer no portrait
 * is worse than showing a slightly-used-over one, and the asset row records
 * exactly which value was the source.
 */
export function storedPhotoValueFor(
  formData: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!formData) return undefined;
  const candidates: string[] = [];
  for (const key of PHOTO_KEYS) {
    const value = formData[key];
    const text = typeof value === 'string' ? value.trim() : objectPhotoValue(value);
    if (text && !isRenderedPortrait(text)) candidates.push(text);
  }
  return candidates.find((text) => uploadObjectKeyFor(text) !== null) ?? candidates[0];
}

/**
 * A stored upload response reduced to the one string that names the file.
 *
 * Preferring `storageKey` over `previewUrl` keeps the durable object name
 * instead of an in-app route that only the uploader may fetch. An object with
 * neither field is not a photograph: `String(value)` would produce
 * `[object Object]`, which the registry would then faithfully record as the
 * contestant's portrait.
 */
function objectPhotoValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const blob = value as { storageKey?: unknown; previewUrl?: unknown };
  for (const field of [blob.storageKey, blob.previewUrl]) {
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return undefined;
}

/**
 * The presentation a promotion should record for one registration.
 *
 * Reads the newest job first: an application that has already been through the
 * pipeline has a row, and minting a second one for the same photo+template is
 * what the run key exists to prevent — but calling the registry anyway spends
 * two writes and a vendor presign to be told `already_existed`.
 *
 * Never throws. A registration whose job store is unreachable is approved with
 * its original photograph and the reason recorded, because the alternative is
 * the admin seeing a 500 for a decision they are entitled to make.
 */
export async function resolveReviewPhotoOutcome(input: {
  rawPhotoUrl?: string | null;
  registrationId: string;
  contestSlug?: string | null;
}): Promise<PhotoPresentation> {
  const stored = (input.rawPhotoUrl ?? '').trim();
  if (!stored) return { mode: 'original', photoUrl: '', reason: 'noPhoto' };

  let existing: PhotoJob | null;
  try {
    existing = await getLatestPhotoJob(input.registrationId);
  } catch (err) {
    // `job-store` answers null for a failed query, so reaching here means the
    // client itself could not be built — a misconfigured deployment, not a
    // vendor problem, and still not a reason to fail the review.
    return { mode: 'original', photoUrl: stored, reason: messageOf(err) };
  }
  if (existing) return fromJob(existing, stored);

  if (isRenderedPortrait(stored)) {
    // Belt-and-braces for callers that hand over a raw column value instead of
    // `storedPhotoValueFor`'s answer: a rendered portrait is displayed, and is
    // never registered. Minting the immutable `original` asset row from it
    // would make a composite the source of every later re-render, which is the
    // one thing spec §11's separate-assets rule forbids. The job was still
    // checked first, so a row that *does* have a job answers from its assets.
    return {
      mode: 'original',
      photoUrl: stored,
      reason: 'The stored value is a rendered portrait, so there is no upload to register as the original',
    };
  }

  const outcome = await registerOriginalAndEnqueue({
    registrationId: input.registrationId,
    contestSlug: input.contestSlug ?? null,
    storedPhotoValue: stored,
  });

  if (outcome.jobId) {
    // Fire-and-forget: the queue may already be drained by another request, and
    // either way this approval is not waiting on it.
    kickDrain();
    return { mode: 'processing', photoUrl: stored, originalAssetId: defined(outcome.assetId) };
  }

  return {
    mode: 'original',
    photoUrl: stored,
    originalAssetId: defined(outcome.assetId),
    reason: skipReason(outcome.skipped ?? 'unknown'),
  };
}

async function fromJob(job: PhotoJob, stored: string): Promise<PhotoPresentation> {
  const originalAssetId = defined(job.source_asset_id);

  switch (job.status) {
    case 'ready': {
      const published = await publishedPortraitFor(job.registration_id).catch((err) => {
        console.warn('[photo-jobs] published portrait read failed:', messageOf(err));
        return null;
      });
      if (published) {
        return { mode: 'composite', photoUrl: published.url, photoAssetId: published.assetId, originalAssetId };
      }
      // `ready` proves the runner stored bytes; a null URL therefore means this
      // deployment cannot serve them (no public base, no presign). Report the
      // original rather than an empty `photoUrl` that would render a broken frame.
      return {
        mode: 'original',
        photoUrl: stored,
        originalAssetId,
        reason: 'The finished portrait is recorded but no URL could be derived for it (storage is not configured on this deployment)',
      };
    }
    case 'queued':
    case 'extracting':
    case 'compositing':
      return { mode: 'processing', photoUrl: stored, originalAssetId };
    case 'cancelled':
      // The runner cancels a job only on a content-moderation verdict, so this
      // is the one mode the review path must refuse rather than present.
      return { mode: 'rejected', photoUrl: stored, originalAssetId, reason: job.last_error || 'content moderation' };
    default:
      // `failed` and `paused`: the ladder owns the retry, and the original is a
      // usable portrait meanwhile.
      return { mode: 'original', photoUrl: stored, originalAssetId, reason: job.last_error || undefined };
  }
}

const defined = (value: string | null): string | undefined => value ?? undefined;

/**
 * Start rendering at submission, so a contestant can be shown a preview before
 * anyone reviews them (spec §6).
 *
 * Returns `{ started }` instead of throwing: this runs after a submission has
 * already been booked, and a photo pipeline that cannot start must not turn a
 * successful application into a failed request. The caller logs `started: false`
 * and moves on; nothing about the submission itself depends on the answer.
 */
export async function startPhotoForSubmission(input: {
  registrationId: string;
  contestSlug?: string | null;
  formData: Record<string, unknown> | null | undefined;
}): Promise<{ started: boolean }> {
  const stored = storedPhotoValueFor(input.formData);
  if (!stored) return { started: false };
  try {
    const outcome = await registerOriginalAndEnqueue({
      registrationId: input.registrationId,
      contestSlug: input.contestSlug ?? null,
      storedPhotoValue: stored,
    });
    if (!outcome.jobId) return { started: false };
    kickDrain();
    return { started: true };
  } catch (err) {
    console.warn('[photo-jobs] submission enqueue failed:', messageOf(err));
    return { started: false };
  }
}
