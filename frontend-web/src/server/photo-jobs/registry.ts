/**
 * The single entry point the rest of the app uses to put a contestant's
 * photograph into the compositing pipeline (spec §5, acceptance criterion 16).
 *
 * Order is the whole design: resolve what we can, record the original as an
 * asset row, and only then ask for a render. The behaviour this replaces wrote
 * the pipeline's output over the one stored photo value, so any failure
 * destroyed the input and left nothing to retry from. Here, a job that cannot
 * run — because the vendor has no URL to fetch, because moderation refused,
 * because the queue write failed — still leaves the photograph recorded and
 * readable. `assetId` comes back on every non-fatal path for exactly that
 * reason, and callers that show a photo should show it from the asset row.
 *
 * What gets stored is the object key, never a signed URL. A presigned URL is a
 * temporary capability with the same shape as a permanent one in a text column,
 * and the row's unique key is built from that value: store the ephemeral string
 * and every re-ingest mints a fresh "original" for the same photograph while the
 * reference quietly stops resolving an hour later.
 *
 * Returns rather than throws. The callers are the submit and review paths, both
 * of which must keep working when this feature fails, so the outcome is a small
 * record the caller can log or surface — never an exception that turns a broken
 * compositing job into a lost application.
 */
import { contentTypeForKey } from '@/src/lib/storage/local-uploads';
import { resolveFetchableSource, uploadObjectKeyFor } from '@/src/lib/media/asset-source';
import { resolveConnectContestId } from '@/src/server/registration/connect-contest-id';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';
import { buildRunKey, enqueuePhotoJob, upsertPhotoAsset } from './job-store';

export interface RegisterInput {
  registrationId: string;
  /**
   * Which contest this entry belongs to. Either form is accepted because the
   * rest of the registration flow carries a slug while the admin and job paths
   * carry the `connect_contests` id; the slug is resolved to an id here so no
   * caller has to duplicate that query.
   */
  contestSlug?: string | null;
  contestId?: string | null;
  /** The value currently stored in `form_data['media.photoUrl']`. */
  storedPhotoValue: string;
  /**
   * Contestant positioning choices from the preview editor. Part of the run key,
   * which is what lets a re-crop of the same photo be a new job rather than a
   * replay of the finished one.
   */
  renderParams?: Record<string, unknown>;
}

export interface RegisterOutcome {
  /** The original's asset row id, or null when nothing was recorded. */
  assetId: string | null;
  /** The queued render's id, or null when no job was created. */
  jobId: string | null;
  /**
   * Why no job was created, or null when one was. Kept as a short machine-ish
   * string (`noPhoto`, `assetWriteFailed`, `enqueueFailed`, `noTemplate`, or
   * `<sourceKind>: <reason>`) so a caller can log it and an operator can read
   * it without this module owning any presentation. `noTemplate` is the only
   * one that is expected in normal operation: the original is recorded and the
   * render is queued once an admin publishes a template.
   */
  skipped: string | null;
}

export async function registerOriginalAndEnqueue(
  input: RegisterInput,
): Promise<RegisterOutcome> {
  const stored = (input.storedPhotoValue || '').trim();
  if (!stored) return { assetId: null, jobId: null, skipped: 'noPhoto' };

  // Skipped rather than called with an empty slug: the helper answers null for
  // that input anyway, and a queue writer that fires a pointless query on every
  // photo-less call is how a hot path ends up rate-limited by its own database.
  const contestId =
    input.contestId ?? (input.contestSlug ? await resolveConnectContestId(input.contestSlug) : null);

  // Both of these read the stored value; neither may fail. The key is what the
  // row stores, the fetchable source is only what the vendor can be given, and
  // a machine without R2 credentials still has to record the photograph.
  const objectKey = uploadObjectKeyFor(stored);
  const resolved = await resolveFetchableSource(stored);

  // An object we own is referenced by key; anything else — a CDN URL from an
  // older import, a value this module does not recognise — is kept verbatim in
  // provider_url. Storing the unrecognised form is not a claim that it is
  // fetchable; it is the alternative to losing the only pointer we have.
  const storageKey = objectKey;
  const providerUrl = objectKey ? null : stored;

  const assetId = await upsertPhotoAsset({
    registrationId: input.registrationId,
    kind: 'original',
    storageKey,
    providerUrl,
    // Derived from the name rather than assumed: a PNG original labelled
    // image/jpeg is a wrong fact on an immutable row forever, and this is the
    // only place the label is chosen.
    contentType: contentTypeForKey(objectKey ?? stored),
    contestId,
  });
  if (!assetId) return { assetId: null, jobId: null, skipped: 'assetWriteFailed' };

  if (!resolved.ok) {
    // The original is safe; the render cannot run yet. Reported as a skipped
    // reason rather than enqueued to fail six times and pause for review.
    return { assetId, jobId: null, skipped: `${resolved.kind}: ${resolved.reason}` };
  }

  const template = contestId ? await resolveActiveTemplateForContest(contestId) : null;
  if (!template) {
    // Recorded, not queued. `runPhotoJob` cannot composite without an active
    // template, and it discovers that *after* it has read the original's bytes,
    // presigned a URL for the vendor and paid for a moderation pass — so a job
    // queued here would spend one paid vendor call six times and then sit in
    // `paused`, which the admin config surface correctly reports as needing an
    // operator. In P1 that is the normal state of a contest: the template studio
    // is P3. A configuration gap must not be written into the queue as a fault.
    return { assetId, jobId: null, skipped: 'noTemplate' };
  }
  const templateId = template.templateId;

  const job = await enqueuePhotoJob({
    runKey: buildRunKey({ sourceAssetId: assetId, templateId, renderParams: input.renderParams }),
    registrationId: input.registrationId,
    sourceAssetId: assetId,
    contestId,
    templateId,
    renderParams: input.renderParams,
  });

  return { assetId, jobId: job?.jobId ?? null, skipped: job ? null : 'enqueueFailed' };
}
