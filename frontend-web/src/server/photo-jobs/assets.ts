/**
 * Reading an asset's bytes back from whichever store holds them (spec §11).
 *
 * Two locations, because the table has two: `storage_key` is an object in our
 * own bucket or, on a machine with no R2 credentials, a file under the local
 * upload root; `provider_url` is somebody else's URL — a Cloudinary cutout the
 * vendor handed back, or a photo a client submitted by link.
 *
 * The value-not-exception contract is deliberate. This runs inside a claimed
 * job, and a job that throws is indistinguishable from a bug in the runner,
 * while a job that answers "unreadable" with the reason is something an operator
 * can act on. The one case that must never be papered over is reported in the
 * log, not the row: the runner already has a single message for "the bytes were
 * not there", and putting the vendor's URL inside it would copy a signed link
 * into the job ledger.
 *
 * A stored URL is only fetched when its host is on the allowlist the compositor
 * already uses (`isAllowedRemoteImageUrl`). A background job with no user in the
 * loop reading an arbitrary URL from a database row is an SSRF primitive, and an
 * allowlist is the policy this app already enforces for exactly that reason.
 */
import { isAllowedRemoteImageUrl } from '@/lib/config';
import { hasR2Config, readR2Object } from '@/src/lib/storage/r2';
import { readLocalUpload } from '@/src/lib/storage/local-uploads';

export interface AssetLocation {
  storage_key: string | null;
  provider_url: string | null;
}

async function fetchAllowed(url: string, context: string): Promise<Buffer | null> {
  if (!isAllowedRemoteImageUrl(url)) {
    console.warn(`[photo-jobs] refusing to fetch a ${context} whose host is not allowlisted: ${url}`);
    return null;
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`[photo-jobs] ${context} fetch answered ${res.status}`);
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function readAssetBytes(asset: AssetLocation): Promise<Buffer | null> {
  try {
    if (asset.storage_key) {
      // No R2 credentials means the key can only name a local upload — which is
      // the only thing that ever wrote one (see local-uploads.ts:136, itself
      // `Buffer | null`).
      if (!hasR2Config()) return await readLocalUpload(asset.storage_key);
      return await readR2Object(asset.storage_key);
    }
    if (asset.provider_url) return await fetchAllowed(asset.provider_url, 'provider_url');
    console.warn('[photo-jobs] asset row has neither a storage key nor a provider URL');
  } catch (err) {
    console.warn('[photo-jobs] asset read failed:', err instanceof Error ? err.message : err);
  }
  return null;
}
