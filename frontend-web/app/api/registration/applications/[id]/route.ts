import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { applyAccountPrefill, getRegistrationDraft, saveRegistrationStep } from '@/src/server/registration/supabase-store';
import { getOrCreateUserProfile } from '@/src/server/user/profile';
import { buildAccountPrefill } from '@/src/features/registration/account-prefill';
import type { RegistrationStepKey } from '@/src/features/registration/types';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    // Validate param
    if (!params?.id || typeof params.id !== 'string') {
      return errorResponse('Invalid application ID', 400);
    }

    const { user } = await requireUser(request);
    const draft = await getRegistrationDraft(params.id);
    if (!draft) {
      console.warn('[registration/applications GET] draft not found:', params.id);
      return errorResponse('Application not found', 404);
    }
    if (draft.userId !== user.id) {
      console.warn('[registration/applications GET] forbidden access to:', params.id, 'by user:', user.id);
      return errorResponse('Forbidden', 403);
    }

    // Drafts started before account prefill existed still ask for details the
    // account already holds — fill their blanks on first open. No-ops once done.
    let prefilled = draft;
    try {
      const profile = await getOrCreateUserProfile({ id: user.id, email: user.email || undefined });
      prefilled = await applyAccountPrefill(draft, buildAccountPrefill(profile));
    } catch (error) {
      console.warn('[registration] could not prefill from the account:', error);
    }

    const steps = buildRegistrationSteps(prefilled);
    return successResponse({ success: true, draft: prefilled, steps });
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

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    // Validate param
    if (!params?.id || typeof params.id !== 'string') {
      return errorResponse('Invalid application ID', 400);
    }

    const { user } = await requireUser(request);
    const current = await getRegistrationDraft(params.id);
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

    const result = await saveRegistrationStep({
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
