import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config, sanitizeObjectFileName } from '@/src/lib/storage/r2';
import { buildAudioResponse } from '@/src/server/openmic/song-stream';
import { decodeBeatFileKey, isPublicBeatObjectKey } from '@/src/features/openmic/beat-storage';

/**
 * Serve the official beat. PUBLIC by design: the artist hearing the beat before
 * registering is not signed in, and gating it on the upload permission would
 * mean only the admin who uploaded it ever hears it.
 *
 * Only `openmic-beats/` keys are served, and anything else is a 404 rather than
 * a 403, so this route cannot be used to test whether a private object (the
 * registration documents sharing this bucket) exists.
 */
export async function GET(request: Request, ctx: { params: Promise<{ fileKey: string }> }) {
  const { fileKey } = await ctx.params;
  // No decodeURIComponent: base64url is already URL-safe, and decoding twice
  // would throw on a hostile value instead of 404ing it. An empty segment is
  // already refused inside decodeBeatFileKey.
  const objectKey = decodeBeatFileKey(fileKey);
  if (!objectKey || !isPublicBeatObjectKey(objectKey)) return new NextResponse('Not found', { status: 404 });

  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const disposition: 'inline' | 'attachment' = wantsDownload ? 'attachment' : 'inline';
  const fileName = sanitizeObjectFileName(objectKey.split('/').pop() || 'beat.mp3');

  if (!hasR2Config()) {
    // The same byte server the song reader uses, rather than a second, weaker
    // copy of it: an `<audio>` element asks for ranges, and a route that answers
    // a range request with a whole 200 file gives the player nothing to scrub.
    // `immutable` is safe here because the key carries the beat's uuid, so this
    // URL always addresses these exact bytes.
    return buildAudioResponse({
      objectKey,
      fileName,
      rangeHeader: request.headers.get('range'),
      cacheControl: 'public, max-age=31536000, immutable',
      disposition,
    });
  }

  try {
    await assertR2ObjectExists(objectKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  // The signed GET names the file on both dispositions, so this one is not wasted.
  const signedUrl = await createR2DownloadUrl({ key: objectKey, fileName, disposition });
  return NextResponse.redirect(signedUrl, { status: 302 });
}
