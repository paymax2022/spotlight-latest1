import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { adminResolveUtilityDispute } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilitySupport, utilityAdminUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilitySupport(request);
    const body = await request.json() as Record<string, unknown>;
    const status = body.status === 'rejected' ? 'rejected' : body.status === 'resolved' ? 'resolved' : null;
    const resolutionNote = typeof body.resolution_note === 'string'
      ? body.resolution_note.trim()
      : typeof body.resolutionNote === 'string'
        ? body.resolutionNote.trim()
        : '';
    if (!status) return errorResponse('status must be resolved or rejected.', 400);
    if (!resolutionNote) return errorResponse('resolution_note is required.', 400);
    const dispute = await adminResolveUtilityDispute(params.id, status, resolutionNote);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.dispute.resolve',
      entityType: 'utility_dispute',
      entityId: params.id,
      newValue: { status },
      reason: resolutionNote,
    });
    return successResponse({ success: true, dispute });
  } catch (err) {
    return handleApiError(err);
  }
}
