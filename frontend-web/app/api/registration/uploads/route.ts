import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { createR2UploadUrl, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';

const MAX_FILE_SIZE_MB = 100;
const allowedExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
  '.mov',
  '.mp3',
  '.wav',
  '.m4a',
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
]);

// Durable storage for registration uploads lives in Cloudflare R2, in whichever
// bucket `R2_BUCKET`/`R2_BUCKET_NAME` names — src/lib/storage/r2.ts resolves it
// and throws 'R2 storage is not configured.' when any piece is missing, so there
// is no default to go stale. The registration client posts the file buffer in a
// single multipart request, so we proxy that buffer to R2 here via a presigned
// PUT, then hand back a stable retrieval route as `previewUrl` (it issues a
// short-lived presigned GET on demand — see `[fileKey]/route.ts`).
export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return errorResponse('file is required', 400);
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      return errorResponse('Unsupported file format', 400);
    }

    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      return errorResponse(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const objectKey = `registration/${user.id}/${randomUUID()}${ext}`;

    // Stable retrieval route — encodes the full (slash-containing) key into a
    // single path segment so the route param survives. The GET route resolves
    // the file (R2 presigned GET in prod, local file in dev) on each access.
    const fileKeyParam = Buffer.from(objectKey, 'utf8').toString('base64url');
    const previewUrl = `/api/registration/uploads/${fileKeyParam}`;

    let signedPreviewUrl = previewUrl;

    if (hasR2Config()) {
      // Proxy the buffer to R2 using a presigned PUT. This keeps R2 credentials
      // server-side while reusing the existing storage helper as-is.
      const uploadUrl = await createR2UploadUrl({ key: objectKey, contentType });
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: buffer,
      });
      if (!putResponse.ok) {
        throw new Error(`R2 upload failed with status ${putResponse.status}`);
      }
      // A short-lived signed GET for immediate inline preview by the client.
      signedPreviewUrl = await createR2DownloadUrl({
        key: objectKey,
        fileName: file.name,
        disposition: 'inline',
      });
    } else {
      // No R2 configured (e.g. local dev): persist to the local filesystem so
      // uploads work without cloud credentials. Retrieval streams from the same
      // stable route.
      await saveLocalUpload(objectKey, buffer);
    }

    return successResponse({
      success: true,
      upload: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: contentType,
        storageKey: objectKey,
        key: objectKey,
        previewUrl,
        signedPreviewUrl,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    // Surface the real reason (R2 misconfig, filesystem permissions, etc.) so
    // failures are diagnosable instead of a blanket "Upload failed".
    console.error('[registration/uploads] upload failed:', error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Upload failed: ${detail}`, 500);
  }
}
