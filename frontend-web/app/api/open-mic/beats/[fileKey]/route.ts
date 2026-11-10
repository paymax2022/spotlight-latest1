import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config, sanitizeObjectFileName } from '@/src/lib/storage/r2';
import { contentTypeForKey, readLocalUpload } from '@/src/lib/storage/local-uploads';
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

  if (!hasR2Config()) {
    const buffer = await readLocalUpload(objectKey);
    if (!buffer) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        // Canonical, from the extension — never the uploader's client-supplied
        // type (SEC-007).
        'Content-Type': contentTypeForKey(objectKey),
        // A bare `inline` is what the banner reader has always sent and what the
        // <audio> element needs; only a download names a file, so only a download
        // needs a name at all.
        'Content-Disposition': wantsDownload
          ? `attachment; filename="${sanitizeObjectFileName(objectKey.split('/').pop() || 'beat.mp3')}"`
          : 'inline',
        // Public and immutable: the key carries a uuid, so a given URL always
        // addresses the same bytes.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  try {
    await assertR2ObjectExists(objectKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  // The signed GET names the file on both dispositions, so this one is not wasted.
  const fileName = sanitizeObjectFileName(objectKey.split('/').pop() || 'beat.mp3');
  const signedUrl = await createR2DownloadUrl({ key: objectKey, fileName, disposition });
  return NextResponse.redirect(signedUrl, { status: 302 });
}
