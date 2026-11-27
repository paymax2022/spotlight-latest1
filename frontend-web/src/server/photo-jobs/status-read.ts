/**
 * The read half of the photo status surface (spec §6, §8).
 *
 * Two endpoints — "my job by id" and "my newest job for this registration" —
 * answer with one shape, so the shape lives here rather than being written twice
 * and drifting. Both rest on the same two rules:
 *
 * 1. Ownership is decided from the row, never from the request. RLS denies
 *    `contest_photo_jobs` and `contest_photo_assets` to every role but the
 *    service one, so a client cannot read the row for itself and this BFF is the
 *    only place the check can happen. The registration's user comes from the
 *    `registrations(user_id)` embed in `job-store`.
 * 2. A `ready` job is the only one with assets to show. Everything else answers
 *    `assets: {}`, which is what lets a surface hold the original photograph
 *    under `presentation: 'original'` instead of a half-drawn frame.
 */
import { IN_APP_PHOTO_TTL_SECONDS } from '@/src/lib/storage/contestant-photo';
import { createR2DownloadUrl, getR2PublicUrl, hasR2Config } from '@/src/lib/storage/r2';
import { maybeDrainPhotoJobs } from './worker';
import { listPhotoAssets, type PhotoAsset, type PhotoJob } from './job-store';

/** The kinds a contestant may be shown. `original` is their own upload and comes
 *  from the registration's media blob, and `transparent` is a vendor cutout — an
 *  intermediate that must not become a public image of someone's face. */
const PUBLISHABLE_KINDS = ['final', 'preview', 'thumbnail'] as const;

/** `cancel_photo_job`'s own `where status not in (...)` guard, mirrored here so
 *  the route can tell a caller their cancel changed nothing instead of reporting
 *  success for a statement that updated zero rows. The guard stays in SQL too:
 *  a job that turns `ready` between this read and that call is cancelled by the
 *  database refusing, and the next poll reports the truth either way. */
export const TERMINAL_FOR_CANCEL = ['ready', 'cancelled'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One uuid test for every id this feature reads from a path or a query.
 *
 * A malformed uuid reaches Postgres as 22P02 and comes back a 500, so it is refused
 * here — the same guard `app/api/v1/contestants/[id]/photo` uses. It is shared rather
 * than per-route because the by-id route, the latest route and the registration id
 * they filter by are the same kind of value: a uuid the caller typed.
 */
export function isUuidId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * The URL a surface can put in an `<img>`, derived at read time and never stored.
 *
 * Deliberately NOT `resolveContestantPhotoUrl`: that resolver is the privacy gate
 * for a member's own uploaded photo and admits only the `registration/` and
 * `contestants/images/` prefixes, because handing it an arbitrary key would point
 * a public page at the identity documents that share the member's prefix. Our
 * rendered output lives under `contestants/composited|preview|thumbnail/`, is a
 * different class of content, and gets here through a key read from the database
 * by a caller who has already proved they own the registration — so it is signed
 * directly, with the same helper that resolver uses.
 *
 * With no bucket configured there is no URL to give: the runner cannot have
 * stored a composite in the first place (`storePhoto` refuses), so `ready` and
 * "no R2" do not occur together and an empty answer is honest rather than a gap.
 */
async function assetUrl(key: string): Promise<string | null> {
  if (!hasR2Config()) return null;
  const publicBase = getR2PublicUrl(key);
  if (publicBase) return publicBase;
  try {
    return await createR2DownloadUrl({
      key,
      fileName: key.split('/').pop() || 'photo',
      disposition: 'inline',
      expiresIn: IN_APP_PHOTO_TTL_SECONDS,
    });
  } catch (err) {
    console.warn('[photo-jobs] asset url derivation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** The newest row of one kind, or null when the registration has none.
 *
 * `listPhotoAssets` is deliberately oldest-first, because an asset row is a
 * stored fact and a ledger reads that way. The portrait a surface must show is
 * the opposite end of that list: re-rendering with different editor settings
 * appends a second `final` row rather than replacing the first (the immutability
 * trigger forbids an update), so the older one is the previous answer, not the
 * current one. Reading `.find()` here would pin a contestant to the crop they
 * edited away from. */
function latestOfKind(assets: PhotoAsset[], kind: (typeof PUBLISHABLE_KINDS)[number]): PhotoAsset | null {
  for (let i = assets.length - 1; i >= 0; i -= 1) {
    const row = assets[i];
    if (row.kind === kind && row.storage_key) return row;
  }
  return null;
}

/**
 * The published portrait for one registration, in the shape a caller that has no
 * job row can use.
 *
 * Prefers `final` (the full-resolution composite) and falls through to the
 * variants only when the runner stored those but not the final row — which it
 * cannot do, so in practice the fallbacks exist for a partial write from an older
 * build rather than for a normal path.
 */
export async function publishedPortraitFor(
  registrationId: string,
): Promise<{ url: string; assetId: string } | null> {
  const assets = await listPhotoAssets(registrationId);
  for (const kind of PUBLISHABLE_KINDS) {
    const row = latestOfKind(assets, kind);
    if (!row?.storage_key) continue;
    const url = await assetUrl(row.storage_key);
    if (url) return { url, assetId: row.id };
  }
  return null;
}

/**
 * The answer the poll target gives: status, truthful progress, the reason when
 * there is one, and — only for a finished job — the published asset URLs.
 */
export async function photoJobPayload(job: PhotoJob): Promise<Record<string, unknown>> {
  const assets: PhotoAsset[] = job.status === 'ready' ? await listPhotoAssets(job.registration_id) : [];
  const urls: Record<string, string> = {};
  for (const kind of PUBLISHABLE_KINDS) {
    const row = latestOfKind(assets, kind);
    const url = row?.storage_key ? await assetUrl(row.storage_key) : null;
    if (url) urls[kind] = url;
  }

  return {
    id: job.id,
    status: job.status,
    // `complete_photo_job` writes progress 100 with the status in one statement,
    // so a ready row already carries it; clamping here would hide a row that
    // reached `ready` with a stale progress value instead of reporting it.
    progress: job.status === 'ready' ? 100 : job.progress,
    attempt: job.attempt,
    resultAssetId: job.result_asset_id ?? null,
    // A terminal verdict worth reading; nothing else, because a transient
    // `last_error` on a job that later succeeded reads as a complaint.
    lastError:
      job.status === 'failed' || job.status === 'paused' || job.status === 'cancelled'
        ? job.last_error ?? null
        : null,
    assets: urls,
  };
}

/**
 * Fire the queue at the traffic that is already looking at it, and let nothing
 * about that kick change the answer: an idle process starts a queued job on the
 * first poll, and a fault inside a background drain stays a background fault.
 */
export function kickDrain(): void {
  try {
    maybeDrainPhotoJobs();
  } catch (err) {
    console.warn('[photo-jobs] opportunistic drain kick failed:', err instanceof Error ? err.message : err);
  }
}
