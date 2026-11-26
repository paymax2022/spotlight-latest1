/**
 * Resolves a stored photo value into something a vendor can fetch itself.
 *
 * Cloudinary's upload API is given a URL and downloads it server-side, so a
 * relative in-app route (`/api/registration/uploads/<base64url key>`, which is
 * exactly what `form_data['media.photoUrl']` holds today) or a `file:` path is
 * not a source — it is a guaranteed vendor failure that surfaces as a
 * fail-closed moderation rejection, i.e. the worst possible error message for
 * what is really a plumbing problem.
 *
 * The presigned branch is deliberate. The original photograph is never made
 * public: what the vendor receives is a time-boxed read derived from the object
 * key at call time, with the shortest window that survives a slow upload. It is
 * never stored on a row and never logged, which is also why nothing here
 * returns a permanent `getR2PublicUrl` link.
 *
 * Our own route is presigned whether it arrives relative or absolute — the
 * absolute form is what mobile and older rows store, and fetching it would hit
 * the owner check on `app/api/registration/uploads/[fileKey]` and fail.
 *
 * Consequence worth stating for whoever runs this locally: with no R2
 * credentials in the environment there is nothing to presign, so the answer is
 * an honest `notFetchable` rather than a guessed URL. Dev photo jobs therefore
 * need R2 creds (or the stub provider in Task 6) to reach a vendor at all.
 */
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

/** The route the upload endpoint mints, relative. */
const UPLOAD_ROUTE = /^\/api\/registration\/uploads\/([A-Za-z0-9_-]+)$/;

/** Ten minutes matches R2's own default download TTL and is long enough for a
 * large PNG to leave Cloudinary's origin fetch before the signature expires. */
export const DEFAULT_PROVIDER_TTL_SECONDS = 600;

export type FetchableSource =
  | { ok: true; url: string; objectKey: string | null; ttlSeconds: number }
  | { ok: false; reason: string; kind: 'relative' | 'notFetchable' | 'noProviderUrl' };

/**
 * base64url -> object key, accepting only the shape the upload route actually
 * writes (`registration/<user id>/<uuid>.<ext>`). The return value is what gets
 * presigned, so a payload that decodes to traversal or to anything else is
 * refused rather than normalised.
 */
export function decodeUploadRouteKey(value: string): string | null {
  const match = UPLOAD_ROUTE.exec((value || '').trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  return /^registration\/[^/]+\/[^/]+\.\w+$/.test(decoded) ? decoded : null;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

async function presign(objectKey: string, ttlSeconds: number): Promise<FetchableSource> {
  if (!hasR2Config()) {
    return {
      ok: false,
      kind: 'notFetchable',
      reason:
        `Object ${objectKey} needs a URL a vendor can fetch, but R2 is not configured to presign one ` +
        '(set R2_ENDPOINT or R2_ACCOUNT_ID with R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME)',
    };
  }
  try {
    const url = await createR2DownloadUrl({
      key: objectKey,
      fileName: objectKey.split('/').pop() || 'photo',
      disposition: 'inline',
      expiresIn: ttlSeconds,
    });
    return { ok: true, url, objectKey, ttlSeconds };
  } catch (err) {
    // A failed presign is a usable answer, not a crash: the job records it and
    // retries on the normal ladder instead of faulting the request that asked.
    return {
      ok: false,
      kind: 'notFetchable',
      reason: `Could not presign ${objectKey}: ${err instanceof Error ? err.message : 'unknown R2 error'}`,
    };
  }
}

export async function resolveFetchableSource(
  storedValue: string,
  // No `siteUrl`: the one case that would have needed it is our own upload
  // route, and that resolves better by presigning the key than by prefixing a
  // host onto a path the owner check would refuse to serve to the vendor.
  opts: { ttlSeconds?: number } = {},
): Promise<FetchableSource> {
  const value = (storedValue || '').trim();
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_PROVIDER_TTL_SECONDS;

  if (!value) {
    return { ok: false, kind: 'noProviderUrl', reason: 'No photo URL stored' };
  }

  const absolute = httpUrl(value);
  const objectKey = absolute
    ? decodeUploadRouteKey(absolute.pathname)
    : value.startsWith('/')
      ? decodeUploadRouteKey(value)
      : null;

  if (objectKey) return presign(objectKey, ttlSeconds);

  if (absolute) {
    // Already a public/CDN URL from somewhere else: pass it through untouched.
    return { ok: true, url: value, objectKey: null, ttlSeconds };
  }

  if (value.startsWith('/')) {
    return {
      ok: false,
      kind: 'relative',
      reason: `Stored value ${value} is a relative path that is not a Spotlight upload route, so there is no object key to presign`,
    };
  }

  return {
    ok: false,
    kind: 'noProviderUrl',
    reason: 'Stored photo value is neither an absolute http(s) URL nor a Spotlight upload route',
  };
}
