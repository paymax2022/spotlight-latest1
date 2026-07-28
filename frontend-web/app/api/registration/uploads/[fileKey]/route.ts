import { NextResponse } from 'next/server';
import { errorResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { readLocalUpload, contentTypeForKey } from '@/src/lib/storage/local-uploads';

function decodeFileKey(raw: string): string | null {
  try {
    const decoded = Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8');
    // Guard against path traversal and only accept registration-scoped keys.
    if (!decoded.startsWith('registration/') || decoded.includes('..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: { fileKey: string } }) {
  let user;
  try {
    ({ user } = await requireUser(request));
  } catch {
    return errorResponse('Authentication required', 401);
  }

  const objectKey = decodeFileKey(params.fileKey);
  if (!objectKey) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Keys are namespaced as `registration/<userId>/<uuid><ext>` — a user may
  // only retrieve their own uploads.
  const ownerSegment = objectKey.split('/')[1] || '';
  if (ownerSegment !== user.id) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Local-filesystem fallback (dev / no R2 configured): stream the file back.
  if (!hasR2Config()) {
    const buffer = await readLocalUpload(objectKey);
    if (!buffer) {
      return new NextResponse('Not found', { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentTypeForKey(objectKey),
        'Content-Disposition': `inline; filename="${objectKey.split('/').pop() || 'file'}"`,
        'Cache-Control': 'private, no-store',
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

  // Redirect to the short-lived presigned GET URL on R2.
  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
