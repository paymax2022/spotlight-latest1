import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { getRegistrationDraft, saveRegistrationStep } from '@/src/server/registration/supabase-store';
import type { RegistrationStepKey } from '@/src/features/registration/types';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    // Validate param
    if (!params?.id || typeof params.id !== 'string') {
      return errorResponse('Invalid application ID', 400);
    }

    const { user } = await requireUser(request);
    const draft = getRegistrationDraft(params.id);
    if (!draft) {
      console.warn('[registration/applications GET] draft not found:', params.id);
      return errorResponse('Application not found', 404);
    }
    if (draft.userId !== user.id) {
      console.warn('[registration/applications GET] forbidden access to:', params.id, 'by user:', user.id);
      return errorResponse('Forbidden', 403);
    }

    const steps = buildRegistrationSteps(draft);
    return successResponse({ success: true, draft, steps });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    console.error('[registration/applications GET] error for', params.id, {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to load registration application: ${detail}`, 500);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    // Validate param
    if (!params?.id || typeof params.id !== 'string') {
      return errorResponse('Invalid application ID', 400);
    }

    const { user } = await requireUser(request);
    const current = getRegistrationDraft(params.id);
    if (!current) {
      console.warn('[registration/applications PATCH] draft not found:', params.id);
      return errorResponse('Application not found', 404);
    }
    if (current.userId !== user.id) {
      console.warn('[registration/applications PATCH] forbidden access to:', params.id, 'by user:', user.id);
      return errorResponse('Forbidden', 403);
    }

    let body: { stepKey?: RegistrationStepKey; values?: Record<string, unknown> } = {};
    try {
      body = (await request.json()) as {
        stepKey?: RegistrationStepKey;
        values?: Record<string, unknown>;
      };
    } catch (parseError) {
      console.error('[registration/applications PATCH] invalid JSON:', parseError);
      return errorResponse('Invalid request body: malformed JSON', 400);
    }

    if (!body?.stepKey || !body.values) {
      return errorResponse('stepKey and values are required', 400);
    }

    const result = saveRegistrationStep({
      applicationId: params.id,
      stepKey: body.stepKey,
      values: body.values,
    });

    const steps = buildRegistrationSteps(result.draft);
    return successResponse({ success: true, ...result, steps });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    if (error instanceof Error && error.message === 'Application not found') {
      console.warn('[registration/applications PATCH] application not found during save:', params.id);
      return errorResponse('Application not found', 404);
    }
    console.error('[registration/applications PATCH] error for', params.id, {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to save registration step: ${detail}`, 500);
  }
}
