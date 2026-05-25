import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { withdrawRegistrationApplication } from '@/src/server/registration/store';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { note?: string };
    const draft = withdrawRegistrationApplication(params.id, body.note);
    return successResponse({ success: true, draft });
  } catch (error) {
    return handleApiError(error, 'Failed to withdraw application');
  }
}
