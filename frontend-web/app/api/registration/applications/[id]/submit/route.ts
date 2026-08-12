import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { getRegistrationDraft, submitRegistrationApplication } from '@/src/server/registration/supabase-store';
import { requireUser } from '@/src/lib/auth/server';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);
    const current = await getRegistrationDraft(params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.userId !== user.id) return errorResponse('Forbidden', 403);

    const result = await submitRegistrationApplication(params.id);
    if (!result.success) {
      return errorResponse('Application validation failed. Please complete required fields.', 400);
    }

    return successResponse({
      success: true,
      draft: result.draft,
      message: `Your Spotlight application has been submitted successfully. Your application reference number is ${result.draft.reference}.`,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to submit registration application');
  }
}
