import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

/**
 * A `contestants.photo_url` is not necessarily a URL. The registration flow
 * stores the whole upload response ({"fileName","previewUrl","storageKey"}) or
 * just its previewUrl, and that preview route
 * (`/api/registration/uploads/<base64url key>`) is readable ONLY by the member
 * who uploaded the file — so a share crawler or a voter's browser asking for it
 * gets a 403 and no image. The bucket itself is private too.
 *
 * So a photo is rendered by signing its object key at read time, which is what
 * the Go connect module does for the app (`internal/connect/voting/
 * contestant_photo.go`); this is the same rule for the web readers.
 */

/**
 * Long, not short: an OG image is fetched once by a crawler that then caches the
 * result for a day or more, and Next may serve cached metadata, so a 60-minute
 * URL would be dead by the second unfurl. Seven days is the SigV4 ceiling.
 */
const OG_IMAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** For a page's own <img>, which is refetched on every view: an hour. */
export const IN_APP_PHOTO_TTL_SECONDS = 60 * 60;

const UPLOADS_ROUTE_PREFIX = '/api/registration/uploads/';

/** Bucket prefixes that hold a member's own uploaded photo. */
const PHOTO_PREFIXES = ['registration/', 'contestants/images/'];

function decodeKeySegment(segment: string): string | null {
  for (const encoding of ['base64url', 'base64'] as const) {
    try {
      const decoded = Buffer.from(segment, encoding).toString('utf8');
      if (decoded && !decoded.includes('\ufffd')) return decoded;
    } catch {
      /* try the next encoding */
    }
  }
  return null;
}

/**
 * The R2 object key inside a stored photo value, or null when the value is not
 * ours to sign — an external URL, unparseable JSON, or a key outside the photo
 * prefixes. Never returns a path that could reach the private documents sharing
 * the bucket.
 */
export function contestantPhotoObjectKey(stored: string | null | undefined): string | null {
  const value = (stored ?? '').trim();
  if (!value) return null;

  const candidate = value.startsWith('{') ? parseUploadBlob(value) : value;
  if (candidate === null) return null;

  let key = candidate;
  const routeAt = key.indexOf(UPLOADS_ROUTE_PREFIX);
  if (routeAt >= 0) {
    const tail = key.slice(routeAt + UPLOADS_ROUTE_PREFIX.length).split(/[?#]/)[0];
    const decoded = decodeKeySegment(decodeURIComponent(tail));
    if (!decoded) return null;
    key = decoded;
  } else if (key.includes('://')) {
    return null;
  }

  key = key.replace(/^\/+/, '');
  if (key.includes('..') || !PHOTO_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
  return key;
}

function parseUploadBlob(value: string): string | null {
  try {
    const blob = JSON.parse(value) as { storageKey?: unknown; previewUrl?: unknown };
    for (const field of [blob?.storageKey, blob?.previewUrl]) {
      if (typeof field === 'string' && field.trim()) return field.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Turn a stored photo value into something a public page can load: a signed GET
 * for our own keys, the value itself when it is already a reachable URL or path,
 * and null when there is nothing renderable — callers fall back to their
 * placeholder rather than pointing at a 403.
 */
export async function resolveContestantPhotoUrl(
  stored: string | null | undefined,
  ttlSeconds = OG_IMAGE_TTL_SECONDS
): Promise<string | null> {
  const value = (stored ?? '').trim();
  if (!value) return null;

  const key = contestantPhotoObjectKey(value);
  if (key) {
    if (!hasR2Config()) return null;
    try {
      return await createR2DownloadUrl({ key, fileName: key.split('/').pop(), disposition: 'inline', expiresIn: ttlSeconds });
    } catch {
      return null;
    }
  }

  // A blob or an uploads-route value we could not sign has no renderable form:
  // handing it back would point the page at a route that 403s for every viewer
  // but the uploader.
  if (value.startsWith('{') || value.includes(UPLOADS_ROUTE_PREFIX)) return null;
  return value.includes('://') || value.startsWith('/') ? value : null;
}
