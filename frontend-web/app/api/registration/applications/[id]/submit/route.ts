import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { submitRegistrationApplication } from '@/src/server/registration/store';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const result = submitRegistrationApplication(params.id);
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
