import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createR2UploadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';

/**
 * Contest banner upload.
 *
 * The admin form previously offered only a banner URL field, which meant an
 * admin had to host the image somewhere else first — there was no way to get a
 * picture off their machine and onto a contest. This proxies the bytes to R2
 * with server-side credentials and returns the URL the form stores in
 * contests.banner_image_url.
 *
 * Mirrors app/api/crowdfunding/uploads, the proven path in this repo, with two
 * deliberate differences:
 *   · ADMIN-gated on the same permission as contest create/edit
 *     ('programs:manage'), because only someone who may edit the contest should
 *     be able to attach its banner.
 *   · keyed under `contests/banners/`, so the matching public GET can serve
 *     these WITHOUT becoming a reader for the private registration documents
 *     that share the bucket.
 *
 * Falls back to the local filesystem when R2 is unconfigured, so the flow works
 * in dev exactly as it does in production.
 */
const MAX_FILE_SIZE_MB = 8;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function POST(request: Request) {
  try {
    // Assert BEFORE reading the body, matching the sibling contest routes: an
    // unauthenticated caller learns nothing about which payloads are valid.
    await assertAdminPermission(request, 'programs:manage');

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return errorResponse('Banner must be a JPG, PNG or WebP image', 400);
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return errorResponse(`Image exceeds the ${MAX_FILE_SIZE_MB}MB limit`, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'image/jpeg';
    const objectKey = `contests/banners/${randomUUID()}${ext}`;

    if (hasR2Config()) {
      const uploadUrl = await createR2UploadUrl({ key: objectKey, contentType });
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: buffer,
      });
      if (!put.ok) throw new Error(`R2 upload failed with status ${put.status}`);
    } else {
      await saveLocalUpload(objectKey, buffer);
    }

    // ABSOLUTE, not relative. The mobile app renders this straight into an
    // <Image>; a relative path resolves against the phone, not this server.
    const origin = new URL(request.url).origin;
    const fileKeyParam = Buffer.from(objectKey, 'utf8').toString('base64url');
    const url = `${origin}/api/admin/contests/banner/${fileKeyParam}`;

    return successResponse({
      success: true,
      upload: { url, storageKey: objectKey, mimeType: contentType, fileSize: file.size },
    });
  } catch (error) {
    // Surface the real reason so a misconfig is diagnosable rather than a
    // blanket "Upload failed".
    console.error('[admin/contests/banner] upload failed:', error);
    return handleApiError(error);
  }
}
