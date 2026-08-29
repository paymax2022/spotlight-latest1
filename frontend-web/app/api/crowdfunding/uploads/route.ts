import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { createR2UploadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';

/**
 * Campaign cover upload.
 *
 * The crowdfunding wizard had NO upload step. The media step stored the raw
 * picker URI (blob: on web, file:// on native) and the submit payload dropped
 * anything that was not already an http(s) URL — deliberately, since persisting
 * a blob: would render broken for every other viewer. The result was that every
 * campaign reached the server with no cover, and the creator list showed a
 * placeholder for an image the creator had definitely chosen.
 *
 * This mirrors app/api/registration/uploads, which is the proven path in this
 * repo: proxy the bytes to R2 with server-side credentials, and fall back to the
 * local filesystem when R2 is unconfigured so uploads work in dev too.
 *
 * Covers are PUBLIC — unlike registration documents. The key is namespaced
 * `crowdfunding/covers/...` and the matching GET route serves it without auth,
 * because a backer looking at a campaign is not signed in as its creator.
 */
const MAX_FILE_SIZE_MB = 8;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return errorResponse('Cover must be a JPG, PNG or WebP image', 400);
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return errorResponse(`Image exceeds the ${MAX_FILE_SIZE_MB}MB limit`, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'image/jpeg';
    const objectKey = `crowdfunding/covers/${user.id}/${randomUUID()}${ext}`;

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

    // ABSOLUTE, not relative. The mobile app renders this straight into an
    // <Image>, and the submit payload only persists a cover that matches
    // ^https?:// — a relative path would be silently dropped exactly as the
    // blob: URI was.
    const origin = new URL(request.url).origin;
    const fileKeyParam = Buffer.from(objectKey, 'utf8').toString('base64url');
    const url = `${origin}/api/crowdfunding/uploads/${fileKeyParam}`;

    return successResponse({
      success: true,
      upload: { url, storageKey: objectKey, mimeType: contentType, fileSize: file.size },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    // Surface the real reason so a misconfig is diagnosable rather than a
    // blanket "Upload failed".
    console.error('[crowdfunding/uploads] upload failed:', error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Upload failed: ${detail}`, 500);
  }
}
