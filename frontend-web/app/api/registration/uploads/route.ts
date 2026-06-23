import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, successResponse, handleApiError } from '@/src/lib/api/responses';

// FIXME (storage backend — cross-agent flag, owner: fe-bills-registration):
// This endpoint writes uploaded registration files to /tmp (see fs.writeFile below).
// /tmp is EPHEMERAL on cPanel Passenger (lost on restart) and NOT shared across
// Passenger workers, so the previewUrl can 404 from a different worker and files
// vanish on deploy. Swap the storage backend to Cloudflare R2 using the existing
// helper `@/src/lib/storage/r2` (bucket `spotlight-open-mic`, presigned PUT/GET):
//   1. presign a PUT key (e.g. `registration/<uid>/<uuid><ext>`),
//   2. either proxy the buffer to R2 here or return a presigned URL for a direct
//      client PUT (preferred — keeps large binaries off the Node process),
//   3. return a presigned GET as previewUrl instead of `/api/registration/uploads/<key>`.
// Left as-is here to avoid colliding with that agent's in-flight work; tracked as a
// follow-up. Until then, treat uploads as non-durable.

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

export async function POST(request: Request) {
  try {
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
    const folder = path.join('/tmp', 'spotlight-registration-uploads');
    await fs.mkdir(folder, { recursive: true });

    const fileKey = `${Date.now()}-${randomUUID()}${ext}`;
    const filePath = path.join(folder, fileKey);
    await fs.writeFile(filePath, buffer);

    return successResponse({
      success: true,
      upload: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storageKey: fileKey,
        storagePath: filePath,
        // Production note: replace with signed/private object storage URL.
        previewUrl: `/api/registration/uploads/${fileKey}`,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Upload failed');
  }
}
