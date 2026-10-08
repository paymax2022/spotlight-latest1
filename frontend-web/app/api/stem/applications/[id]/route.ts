import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, saveApplicationDraft } from '@/src/server/stem/persistence';
import type { StemApplicationStatus } from '@/src/features/stem/types';
import { requireUser } from '@/src/lib/auth/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return errorResponse('Invalid application ID', 400);
    const application = await getApplication(id);
    if (!application) return errorResponse('Application not found', 404);
    if (application.applicantUserId !== user.id) return errorResponse('Forbidden', 403);
    return successResponse({ success: true, application });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application');
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return errorResponse('Invalid application ID', 400);
    const current = await getApplication(id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const body = (await request.json().catch(() => null)) as {
      status?: StemApplicationStatus;
      categoryId?: string;
      priceCategoryId?: string;
      formData?: Record<string, unknown>;
      projectData?: Record<string, unknown>;
      uploadData?: Record<string, unknown>;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    const application = await saveApplicationDraft(id, {
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
