import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { getRegistrationDraft, saveRegistrationStep } from '@/src/server/registration/store';
import type { RegistrationStepKey } from '@/src/features/registration/types';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const draft = getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);

    const steps = buildRegistrationSteps(draft);
    return successResponse({ success: true, draft, steps });
  } catch (error) {
    return handleApiError(error, 'Failed to load registration application');
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
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
