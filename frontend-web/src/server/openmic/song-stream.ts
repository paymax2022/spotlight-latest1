/**
 * Serving song bytes, whichever storage the deployment has.
 *
 * Two routes play a contestant's song: the public reader that web, admin and
 * mobile all point their `<audio>`/`expo-audio` at, and the admin review route.
 * Both need the same behaviour — presigned passthrough when R2 is configured, a
 * ranged read from local disk when it is not — and both used to be R2-only, which
 * is why localhost answered 404 "Audio not available" for a file it had just
 * written to its own temp directory.
 *
 * The range arithmetic is pure and separate because getting it wrong does not
 * throw: a browser that receives 200 instead of 206 simply cannot scrub, so a
 * player bug would show up as "the audio is stuck", not as an error.
 */
import { contentTypeForKey, readLocalUploadRange, statLocalUpload } from '@/src/lib/storage/local-uploads';
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

/** Any surface may embed this in a cross-origin player (mobile dev server, admin). */
export const SONG_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
  'Access-Control-Allow-Headers': 'Range',
};

export type ByteRange = { start?: number; end?: number; suffix?: number };

/**
 * `bytes=500-1000`, `bytes=500-`, `bytes=-500`.
 *
 * Returns null for anything else, including multiple ranges — a `multipart/byteranges`
 * body is not worth building for an mp3, and a single-range reader (every browser
 * audio element) never asks for one.
 */export function parseByteRange(header: string | null | undefined): ByteRange | null {
  const value = String(header || '').trim().toLowerCase();
  if (!value.startsWith('bytes=')) return null;
  const spec = value.slice('bytes='.length).trim();
  if (!spec || spec.includes(',')) return null;
  const [rawStart, rawEnd, ...extra] = spec.split('-');
  if (extra.length > 0) return null;
  const start = rawStart === '' ? undefined : Number(rawStart);
  const end = rawEnd === '' || rawEnd === undefined ? undefined : Number(rawEnd);
  if (start === undefined && end === undefined) return null;
  if (start !== undefined && (!Number.isInteger(start) || start < 0)) return null;
  if (end !== undefined && (!Number.isInteger(end) || end < 0)) return null;
  if (start === undefined) return { suffix: end };
  if (end !== undefined && end < start) return null;
  return { start, end };
}

export type ResolvedRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable'; totalBytes: number };

/** Turn a parsed range into concrete inclusive bounds against a known length. */
export function resolveByteRange(range: ByteRange | null, totalBytes: number): ResolvedRange {
  if (!range) return { kind: 'full' };
  if (range.suffix !== undefined) {
    if (range.suffix === 0 || totalBytes === 0) return { kind: 'unsatisfiable', totalBytes };
    const length = Math.min(range.suffix, totalBytes);
    return { kind: 'partial', start: totalBytes - length, end: totalBytes - 1 };
  }
  const start = range.start ?? 0;
  if (start >= totalBytes) return { kind: 'unsatisfiable', totalBytes };
  const end = range.end === undefined ? totalBytes - 1 : Math.min(range.end, totalBytes - 1);
  return { kind: 'partial', start, end };
}

/**
 * Quoted-string safe enough to put in a response header.
 *
 * The filename came from the artist's own upload, so it is rendered inert here:
 * a stray `"` or a newline must not let it close the quoted string and append a
 * second header.
 */
export function contentDispositionHeader(disposition: 'inline' | 'attachment', fileName?: string): string {
  const base = String(fileName || 'song.mp3').split(/[\\/]/).pop() || 'song.mp3';
  const safe = base.replace(/["\r\n]/g, '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'song.mp3';
  return `${disposition}; filename="${safe}"`;
}

/**
 * A `Response` carrying the song (or the requested slice of it).
 *
 * Statuses: 200 whole object, 206 slice, 404 no such object, 416 range past EOF.
 */
export async function buildSongResponse(input: {
  objectKey: string;
  fileName?: string;
  rangeHeader?: string | null;
  cacheControl?: string;
  disposition?: 'inline' | 'attachment';
}): Promise<Response> {
  const cacheControl = input.cacheControl ?? 'public, max-age=300';
  const disposition = input.disposition ?? 'inline';
  const dispositionHeader = contentDispositionHeader(disposition, input.fileName);

  if (hasR2Config()) {
    const signedUrl = await createR2DownloadUrl({
      key: input.objectKey,
      fileName: input.fileName,
      disposition,
      expiresIn: 300,
    });
    // R2 honours Range itself, so the presigned passthrough stays the cheap and
    // faithful path: forward the header, forward the status and content headers.
    const stored = await fetch(signedUrl, {
      headers: input.rangeHeader ? { Range: input.rangeHeader } : {},
    });
    if (!stored.ok && stored.status !== 206) {
      return new Response('Audio fetch failed', { status: 502, headers: SONG_CORS_HEADERS });
    }
    const passthrough: Record<string, string> = {
      ...SONG_CORS_HEADERS,
      'Content-Type': stored.headers.get('content-type') || contentTypeForKey(input.objectKey),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    };
    // Only copy what R2 actually sent: an empty `Content-Length` makes the
    // `Response` constructor throw, and a 200 with a stray `Content-Range` is a
    // lie the browser will punish by refusing to play.
    for (const name of ['content-length', 'content-range', 'content-disposition'] as const) {
      const value = stored.headers.get(name);
      if (value) passthrough[name] = value;
    }
    return new Response(stored.body, { status: stored.status, headers: passthrough });
  }

  const stored = await statLocalUpload(input.objectKey);
  if (!stored) return new Response('Audio not available', { status: 404, headers: SONG_CORS_HEADERS });

  const resolved = resolveByteRange(parseByteRange(input.rangeHeader), stored.sizeBytes);
  if (resolved.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...SONG_CORS_HEADERS, 'Content-Range': `bytes */${stored.sizeBytes}` },
    });
  }

  // One read path for both shapes: a full response is the slice from 0, so the
  // local branch never needs a whole-file `readFile` of a 50 MB song.
  const slice = await readLocalUploadRange(input.objectKey, {
    start: resolved.kind === 'partial' ? resolved.start : 0,
    end: resolved.kind === 'partial' ? resolved.end : undefined,
  });
  if (!slice) return new Response('Audio not available', { status: 404, headers: SONG_CORS_HEADERS });

  // `Uint8Array` rather than the `Buffer` itself: `BodyInit` in this TypeScript
  // configuration does not accept Node's Buffer, and the copy is the slice the
  // caller asked for, not the whole song.
  return new Response(new Uint8Array(slice.buffer), {
    status: resolved.kind === 'partial' ? 206 : 200,
    headers: {
      ...SONG_CORS_HEADERS,
      'Content-Type': contentTypeForKey(input.objectKey),
      'Content-Disposition': dispositionHeader,
      'Content-Length': String(slice.buffer.byteLength),
      ...(resolved.kind === 'partial'
        ? { 'Content-Range': `bytes ${resolved.start}-${resolved.end}/${stored.sizeBytes}` }
        : {}),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    },
  });
}
