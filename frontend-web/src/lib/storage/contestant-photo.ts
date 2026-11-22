import { contentTypeForKey, readLocalUpload } from '@/src/lib/storage/local-uploads';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

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
 * contestant_photo.go`); this is the same rule for the web readers — with one
 * thing the Go readers cannot know: when this deployment has no bucket
 * configured, the upload route wrote those same bytes to local disk, and the key
 * must be read from there instead of signed against a bucket that never received
 * the file (`serveContestantPhoto`).
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

/**
 * A `Response` a console page can point an `<img>` at.
 *
 * This is the answering half of the same rule, and it exists because a presigned
 * URL is not a promise that the object is there. `registration/<userId>/` is
 * where the registration flow puts a member's photo, and on any deployment
 * without R2 credentials that flow writes to the local fallback store instead
 * (`$TMPDIR/spotlight-registration-uploads`) — so signing the key against the
 * bucket yields a perfectly valid signature for an object R2 has never heard of
 * (404 NoSuchKey), which the admin console drew as a broken image. Only this
 * plane can see both stores, so only this plane can serve the file.
 *
 * Three answers, in the order they can be trusted:
 *   - the key exists in the bucket  → 307 to a presigned GET (the browser follows it);
 *   - the key is a local upload     → the bytes, with the type their extension implies;
 *   - neither, or an external photo → 307 when the stored value is already a
 *     reachable URL, otherwise 404 — never a preview route, which is 403 for
 *     everyone but the uploader, and never a signature for a missing object.
 *
 * The key always comes from the row that was read, never from the request, so
 * there is no way to ask this responder for an arbitrary object in the bucket.
 */
export async function serveContestantPhoto(
  stored: string | null | undefined,
  ttlSeconds = IN_APP_PHOTO_TTL_SECONDS
): Promise<Response> {
  const value = (stored ?? '').trim();
  const key = contestantPhotoObjectKey(value);

  if (!key) {
    if (/^https?:\/\//i.test(value)) {
      return new Response(null, { status: 307, headers: { Location: value } });
    }
    return photoNotFound('No contestant photo on record');
  }

  if (hasR2Config()) {
    try {
      await assertR2ObjectExists(key);
    } catch {
      // The row names an object the bucket does not have. 404, not a signature
      // for it: a dead presigned URL looks like a working image tag right up
      // until the browser renders nothing.
      return photoNotFound('Contestant photo not found in storage');
    }
    const url = await createR2DownloadUrl({
      key,
      fileName: key.split('/').pop(),
      disposition: 'inline',
      expiresIn: ttlSeconds,
    });
    return new Response(null, { status: 307, headers: { Location: url } });
  }

  const bytes = await readLocalUpload(key);
  if (!bytes) return photoNotFound('Contestant photo not found on this server');

  // Copy the bytes into an ArrayBuffer of their own rather than handing the
  // Buffer (or `new Uint8Array(bytes.buffer)`) to Response.
  //
  // The immediate reason is the type gate: `tsc --noEmit` runs in CI and rejects
  // both forms, because `Buffer<ArrayBufferLike>` is not an
  // `ArrayBufferView<ArrayBuffer>` — a possibly-shared buffer cannot be a body.
  //
  // The copy also makes the body length independent of how the reader allocated.
  // Today that is already true by luck: `readLocalUpload` uses the promises API,
  // which for a 49-byte file returns `buffer.byteLength 49, byteOffset 0`, whereas
  // the sync API pools small reads (`8192` at offset `64`, measured) — so a view
  // over `.buffer` would send 8,192 bytes under a real `Content-Length`. Not a bug
  // in this file as written; a hazard the copy removes.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeForKey(key),
      'Content-Length': String(bytes.byteLength),
      // Who may see this is decided by the caller's gate, so nothing in between
      // may hold a copy for the next visitor.
      'Cache-Control': 'private, no-store',
    },
  });
}

function photoNotFound(message: string): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
