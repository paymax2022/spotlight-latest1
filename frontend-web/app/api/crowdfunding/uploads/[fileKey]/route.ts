import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { readLocalUpload, contentTypeForKey } from '@/src/lib/storage/local-uploads';

/**
 * Serve a campaign cover.
 *
 * PUBLIC by design, and that is the one meaningful difference from the
 * registration equivalent, which requires auth and matches the key's owner
 * segment against the caller. A cover is shown to backers browsing campaigns —
 * gating it behind "you must be its creator" would mean only the creator ever
 * saw the image.
 *
 * Only `crowdfunding/covers/` keys are served, so this cannot be turned into a
 * reader for the private registration documents that share the same bucket.
 */
function decodeCoverKey(raw: string): string | null {
  try {
    const decoded = Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8');
    if (!decoded.startsWith('crowdfunding/covers/') || decoded.includes('..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ fileKey: string }> }) {
  const { fileKey } = await ctx.params;
  const objectKey = decodeCoverKey(fileKey);
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
