import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import {
  bulkMarkNotificationsSent,
  bulkResolveFraudAlerts,
  bulkUpdatePaymentEventStatus,
} from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicAdmin(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');
    const ids = Array.isArray(body?.ids) ? body.ids.map((id: unknown) => String(id)).filter(Boolean) : [];
    if (ids.length === 0) throw new Error('No target ids provided.');

    if (action === 'mark_notifications_sent') {
      const updated = await bulkMarkNotificationsSent(context.params.id, ids);
      return successResponse({ success: true, action, updatedCount: updated.length });
    }
    if (action === 'resolve_fraud_alerts') {
      const updated = await bulkResolveFraudAlerts(context.params.id, ids, body?.resolutionNote);
      return successResponse({ success: true, action, updatedCount: updated.length });
    }
    if (action === 'update_payment_status') {
      const nextStatus = String(body?.paymentStatus || '').toLowerCase();
      if (!['pending', 'successful', 'failed', 'refunded', 'waived'].includes(nextStatus)) {
        throw new Error('Invalid paymentStatus.');
      }
      const updated = await bulkUpdatePaymentEventStatus(context.params.id, ids, nextStatus as any);
      return successResponse({ success: true, action, updatedCount: updated.length, paymentStatus: nextStatus });
    }

    throw new Error('Unsupported action.');
  } catch (error) {
    return handleApiError(error, 'Failed to run moderation action');
  }
}
