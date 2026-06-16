import { assertAdminPermission } from '@/src/server/admin/auth';
import { errorResponse } from '@/src/lib/api/responses';
import { featureFlags } from '@/src/lib/feature-flags';
import { addAuditEvent } from '@/src/server/admin/audit';
import type { AdminIdentity } from '@/src/server/admin/auth';

export function utilityAdminUnavailableResponse() {
  return featureFlags.utilityPayments() ? null : errorResponse('Utility payments feature is not available.', 503);
}

export async function requireUtilityManager(request: Request) {
  return assertAdminPermission(request, 'utility:manage');
}

export async function requireUtilitySupport(request: Request) {
  return assertAdminPermission(request, 'utility:support');
}

export function adminPagination(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  return { limit, offset };
}

export function auditUtilityAdminAction(
  request: Request,
  identity: AdminIdentity,
  input: {
    action: string;
    entityType: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  },
) {
  addAuditEvent({
    adminUser: identity.actorId,
    role: identity.role,
    action: input.action,
    module: 'utility_payments',
    entityType: input.entityType,
    entityId: input.entityId,
    oldValue: input.oldValue,
    newValue: input.newValue,
    reason: input.reason,
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
  });
}
