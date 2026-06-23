import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, successResponse, handleApiError } from '@/src/lib/api/responses';

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
