import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { assertR2ObjectExists, hasR2Config } from '@/src/lib/storage/r2';
import { statLocalUpload } from '@/src/lib/storage/local-uploads';
import { isSubmissionBinding } from '@/src/features/registration/lock';
import { getRegistrationDraft, replaceRegistrationProfilePhoto } from '@/src/server/registration/supabase-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_KEY_RE = /^registration\/([0-9a-f-]{36})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|webp))$/i;

function isMissingR2Object(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === 'NotFound' || candidate.name === 'NoSuchKey';
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return errorResponse('Invalid application ID', 400);

  try {
    const { user } = await requireUser(request);
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return errorResponse('A valid Idempotency-Key is required', 400);
    }

    let body: { storageKey?: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid request body: malformed JSON', 400);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.storageKey !== 'string') {
      return errorResponse('storageKey is required', 400);
    }

    const draft = await getRegistrationDraft(id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);
    if (!isSubmissionBinding(draft.status)) {
      return errorResponse('Profile photos can only be replaced after approval', 409);
    }

    const match = PHOTO_KEY_RE.exec(body.storageKey);
    if (!match || match[1] !== user.id) {
      return errorResponse('Invalid profile photo upload', 400);
    }

    if (hasR2Config()) {
      try {
        await assertR2ObjectExists(body.storageKey);
      } catch (error) {
        if (isMissingR2Object(error)) return errorResponse('Uploaded profile photo not found', 404);
        throw error;
      }
    } else if (!(await statLocalUpload(body.storageKey))) {
      return errorResponse('Uploaded profile photo not found', 404);
    }

    const previewUrl = `/api/registration/uploads/${Buffer.from(body.storageKey, 'utf8').toString('base64url')}`;
    const photo = {
      previewUrl,
      fileName: match[2],
      storageKey: body.storageKey,
    };
    await replaceRegistrationProfilePhoto({
      applicationId: id,
      userId: user.id,
      photo,
    });

    return successResponse({ success: true, photo });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    if (error instanceof Error && error.message.startsWith('Application not found')) {
      return errorResponse('Application not found', 404);
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return errorResponse('Forbidden', 403);
    }
    if (error instanceof ApiError) return handleApiError(error);
    console.error('[registration/applications/profile-photo] replacement failed:', error);
    return handleApiError(error, 'Failed to replace profile photo');
  }
}
