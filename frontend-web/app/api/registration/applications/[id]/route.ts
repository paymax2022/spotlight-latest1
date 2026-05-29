import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { getRegistrationDraft, saveRegistrationStep } from '@/src/server/registration/store';
import type { RegistrationStepKey } from '@/src/features/registration/types';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);
    const draft = getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    const steps = buildRegistrationSteps(draft);
    return successResponse({ success: true, draft, steps });
  } catch (error) {
    return handleApiError(error, 'Failed to load registration application');
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);
    const current = getRegistrationDraft(params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.userId !== user.id) return errorResponse('Forbidden', 403);

    const body = (await request.json()) as {
      stepKey?: RegistrationStepKey;
      values?: Record<string, unknown>;
    };

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
    return handleApiError(error, 'Failed to save registration step');
  }
}
