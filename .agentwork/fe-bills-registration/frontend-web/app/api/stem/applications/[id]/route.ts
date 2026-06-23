import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, saveApplicationDraft } from '@/src/server/stem/persistence';
import type { StemApplicationStatus } from '@/src/features/stem/types';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { user } = await requireUser(request);
    const application = await getApplication(context.params.id);
    if (!application) return errorResponse('Application not found', 404);
    if (application.applicantUserId !== user.id) return errorResponse('Forbidden', 403);
    return successResponse({ success: true, application });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application');
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { user } = await requireUser(request);
    const current = await getApplication(context.params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const body = (await request.json()) as {
      status?: StemApplicationStatus;
      categoryId?: string;
      priceCategoryId?: string;
      formData?: Record<string, unknown>;
      projectData?: Record<string, unknown>;
      uploadData?: Record<string, unknown>;
    };

    const application = await saveApplicationDraft(context.params.id, {
      status: body.status,
      categoryId: body.categoryId,
      priceCategoryId: body.priceCategoryId,
      formData: body.formData,
      projectData: body.projectData,
      uploadData: body.uploadData,
    });

    return successResponse({ success: true, application });
  } catch (error) {
    return handleApiError(error, 'Failed to update STEM application');
  }
}
