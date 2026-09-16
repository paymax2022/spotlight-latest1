import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { readLocalUpload, contentTypeForKey } from '@/src/lib/storage/local-uploads';

/**
 * Serve a campaign supporting document.
 *
 * A SIBLING of ../../[fileKey] rather than a widening of it. That reader allows
 * only `crowdfunding/covers/` keys precisely so it cannot become a general reader
 * for the private registration documents sharing this bucket, and pointing
 * document URLs at it would have meant relaxing exactly that check. Each reader
 * stays narrow: this one serves `crowdfunding/documents/` and nothing else.
 *
 * PUBLIC, like the cover, because the Documents screen is headed "Supporting
 * evidence for this campaign" and is shown to every visitor — a backer deciding
 * whether to give is the person the evidence is FOR. Gating it to the uploader
 * would mean only the creator could ever open their own proof.
 */
function decodeDocumentKey(raw: string): string | null {
  try {
    const decoded = Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8');
    if (!decoded.startsWith('crowdfunding/documents/') || decoded.includes('..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ fileKey: string }> }) {
  const { fileKey } = await ctx.params;
  const objectKey = decodeDocumentKey(fileKey);
  if (!objectKey) return new NextResponse('Not found', { status: 404 });

  if (!hasR2Config()) {
    const buffer = await readLocalUpload(objectKey);
    if (!buffer) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentTypeForKey(objectKey),
        'Content-Disposition': 'inline',
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
