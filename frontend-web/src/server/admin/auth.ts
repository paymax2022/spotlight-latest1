import { ApiError } from '@/src/lib/api/responses';
import { hasPermission, parseAdminRole, type AdminPermission } from '@/src/server/admin/rbac';

export interface AdminIdentity {
  role: ReturnType<typeof parseAdminRole>;
  actorId?: string;
}

export function assertAdminPermission(request: Request, permission: AdminPermission): AdminIdentity {
  const role = parseAdminRole(request.headers.get('x-admin-role') || request.headers.get('x-spotlight-role'));
  const apiKey = request.headers.get('x-admin-key');
  const expectedKey = process.env.SPOTLIGHT_ADMIN_API_KEY;
  const keyAllowed = expectedKey ? apiKey === expectedKey : true;

  if (!keyAllowed) {
    throw new ApiError('Forbidden', 403);
  }

  if (!hasPermission(role, permission)) {
    throw new ApiError('Forbidden', 403);
  }

  return {
    role,
    actorId: request.headers.get('x-actor-id') || undefined,
  };
}
