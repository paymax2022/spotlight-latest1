import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { getRegistrationDraft, saveRegistrationStep } from '@/src/server/registration/supabase-store';
import { requireUser } from '@/src/lib/auth/server';
import type { RegistrationStepKey } from '@/src/features/registration/types';
import { NextResponse } from 'next/server';

/**
 * Strict step-save endpoint — adapter around saveRegistrationStep.
 *
 * The sibling `../route.ts` PATCH is a protected legacy file whose contract
 * returns HTTP 200 with `validation.isValid: false` and persists nothing on a
 * failed step validation — correct for the wizard but ambiguous for API
 * consumers that read only the HTTP status (E2E-USER-017). This endpoint keeps
 * the same save semantics but answers 422 with the same validation payload
 * when the step fails validation, so `res.ok` alone is a trustworthy signal.
 *
 * Valid saves still return 200 with `{ success: true, draft, validation,
 * steps }` — identical to the legacy response.
 */
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
      console.warn('[registration/applications/step PATCH] draft not found:', params.id);
      return errorResponse('Application not found', 404);
    }
    if (current.userId !== user.id) {
      console.warn('[registration/applications/step PATCH] forbidden access to:', params.id, 'by user:', user.id);
      return errorResponse('Forbidden', 403);
    }

    let body: { stepKey?: RegistrationStepKey; values?: Record<string, unknown> } = {};
    try {
      body = (await request.json()) as {
        stepKey?: RegistrationStepKey;
        values?: Record<string, unknown>;
      };
    } catch (parseError) {
      console.error('[registration/applications/step PATCH] invalid JSON:', parseError);
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

    if (result.validation && result.validation.isValid === false) {
      // Error envelope matches neighboring registration routes
      // (`errorResponse`: { success: false, error }) with the validation
      // payload attached so callers can still highlight field errors.
      return NextResponse.json(
        {
          success: false,
          error: 'Step validation failed',
          validation: result.validation,
          draft: result.draft,
          steps,
        },
        { status: 422 },
      );
    }

    return successResponse({ success: true, ...result, steps });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    // supabase-store throws 'Application not found.' (trailing period) — a
    // prefix match covers both spellings so the race between the existence
    // check above and the save can't fall through to the 500 branch.
    if (error instanceof Error && error.message.startsWith('Application not found')) {
      console.warn('[registration/applications/step PATCH] application not found during save:', params.id);
      return errorResponse('Application not found', 404);
    }
    // Input-guard errors thrown by saveRegistrationStep are client errors, not
    // server faults — a bogus stepKey previously fell through to the generic
    // 500 below. 422 mirrors this route's existing validation-failure mapping.
    if (error instanceof Error && error.message === 'Invalid step key.') {
      return errorResponse('Invalid step key', 422);
    }
    if (
      error instanceof Error &&
      (error.message === 'Step key is required' ||
        error.message === 'Values must be a non-empty object' ||
        error.message === 'Invalid application ID')
    ) {
      return errorResponse(error.message, 400);
    }
    console.error('[registration/applications/step PATCH] error for', params.id, {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return handleApiError(error, 'Failed to save registration step');
  }
}
