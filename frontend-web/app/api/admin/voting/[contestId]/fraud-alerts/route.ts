import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveFraudFlag } from '@/src/server/voting/fraud.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? 'open';
    const severity = searchParams.get('severity');

    const supabase = createAdminClient();
    let query = supabase
      .from('fraud_flags')
      .select('*')
      .eq('contest_id', contestId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(200);

    if (severity) query = query.eq('severity', severity);

    const { data, error } = await query;
    if (error) return errorResponse('Failed to load fraud flags', 500);

    return successResponse({ success: true, flags: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load fraud alerts');
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = (await request.json()) as {
      flagId: string;
      status: 'resolved' | 'dismissed' | 'actioned';
      actionTaken: string;
    };

    if (!body.flagId) return errorResponse('flagId is required', 400);
    if (!body.status) return errorResponse('status is required', 400);
    if (!body.actionTaken) return errorResponse('actionTaken is required', 400);

    await resolveFraudFlag(body.flagId, identity.actorId, body.actionTaken, body.status);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'fraud_flag_resolved',
      entityType: 'fraud_flag',
      entityId: body.flagId,
      newValue: { status: body.status, actionTaken: body.actionTaken },
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to resolve fraud flag');
  }
}
