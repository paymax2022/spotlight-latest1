import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { readLocalUpload, contentTypeForKey } from '@/src/lib/storage/local-uploads';

/**
 * Serve a contest banner.
 *
 * PUBLIC by design. The banner is shown to applicants and voters browsing
 * contests in the mobile app, none of whom are admins — gating it behind the
 * upload permission would mean only the admin who uploaded it ever saw it.
 *
 * Only `contests/banners/` keys are served, so this cannot be turned into a
 * reader for the private registration documents that share the same bucket.
 */
function decodeBannerKey(raw: string): string | null {
  try {
    const decoded = Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8');
    if (!decoded.startsWith('contests/banners/') || decoded.includes('..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ fileKey: string }> }) {
  const { fileKey } = await ctx.params;
  const objectKey = decodeBannerKey(fileKey);
  if (!objectKey) return new NextResponse('Not found', { status: 404 });

  if (!hasR2Config()) {
    const buffer = await readLocalUpload(objectKey);
    if (!buffer) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentTypeForKey(objectKey),
        'Content-Disposition': 'inline',
        // Public and immutable: the key contains a uuid, so a given URL always
        // resolves to the same bytes.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  try {
    await assertR2ObjectExists(objectKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const signedUrl = await createR2DownloadUrl({
    key: objectKey,
    fileName: objectKey.split('/').pop(),
    disposition: 'inline',
  });
  return NextResponse.redirect(signedUrl, { status: 302 });
}
