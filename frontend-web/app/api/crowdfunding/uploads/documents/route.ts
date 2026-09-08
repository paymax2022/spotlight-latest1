import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { createR2UploadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';

/**
 * Campaign supporting-document upload.
 *
 * Sibling of ../route.ts (the campaign cover), deliberately separate rather than a
 * `kind` flag on it: the two differ in what they accept (a document may be a PDF),
 * how big they may be, and where they are namespaced, and folding both into one
 * handler would mean a cover-sized limit silently applying to a scanned invoice.
 *
 * The stored object key is `crowdfunding/documents/<user>/<uuid><ext>` and the URL
 * returned is the same `/api/crowdfunding/uploads/<base64url-key>` reader the cover
 * uses, which redirects to a presigned R2 URL.
 */
const MAX_FILE_SIZE_MB = 15;

// Extension → the doc_type the client renders an icon for. The TYPE IS DERIVED
// HERE, never taken from the caller: the list shows a PDF badge, and a caller that
// could label an image as a PDF could make the list lie about what it is offering.
const ALLOWED: Record<string, { docType: 'pdf' | 'image'; mime: string }> = {
  '.pdf': { docType: 'pdf', mime: 'application/pdf' },
  '.jpg': { docType: 'image', mime: 'image/jpeg' },
  '.jpeg': { docType: 'image', mime: 'image/jpeg' },
  '.png': { docType: 'image', mime: 'image/png' },
  '.webp': { docType: 'image', mime: 'image/webp' },
};

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);

    const ext = path.extname(file.name).toLowerCase();
    const allowed = ALLOWED[ext];
    if (!allowed) {
      return errorResponse('A document must be a PDF, JPG, PNG or WebP file', 400);
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return errorResponse(`Document exceeds the ${MAX_FILE_SIZE_MB}MB limit`, 400);
    }
    // A zero-byte file uploads and reads back "successfully" while being nothing at
    // all, which is worse than a refusal: it appears in the list as evidence.
    if (file.size === 0) {
      return errorResponse('Document is empty', 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = allowed.mime;
    const objectKey = `crowdfunding/documents/${user.id}/${randomUUID()}${ext}`;

    if (hasR2Config()) {
      const uploadUrl = await createR2UploadUrl({ key: objectKey, contentType });
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: buffer,
      });
      if (!put.ok) throw new Error(`R2 upload failed with status ${put.status}`);
    } else {
      // No R2 configured (local dev): persist to disk so the flow still works.
      await saveLocalUpload(objectKey, buffer);
    }

    // The DOCUMENTS reader, not the cover one. The cover reader allowlists
    // `crowdfunding/covers/` keys and correctly 404s a document key — pointing
    // here at it would have produced an upload that succeeds and then cannot be
    // opened, which is exactly what the first version of this did.
    const origin = new URL(request.url).origin;
    const fileKeyParam = Buffer.from(objectKey, 'utf8').toString('base64url');
    const url = `${origin}/api/crowdfunding/uploads/documents/${fileKeyParam}`;

    return successResponse({
      success: true,
      upload: {
        url,
        storageKey: objectKey,
        docType: allowed.docType,
        mimeType: contentType,
        fileSize: file.size,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    console.error('[crowdfunding/uploads/documents] upload failed:', error);
    return errorResponse('Upload failed', 500);
  }
}
