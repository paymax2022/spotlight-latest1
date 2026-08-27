import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { approveKyc, failKyc, suspendKyc } from '@/src/server/kyc/service';
import type { KycTier } from '@/src/server/kyc/types';

// ADMIN CONSOLIDATION (see docs/adr/ADR-047 and ../route.ts's header): the
// original page's approve/reject/suspend server actions, ported one-to-one —
// same kyc/service.ts calls, same audit event shape. Gated on
// 'finance:adjust:initiate' rather than the original page's bare
// role==='admin' check: the codebase already defines this permission for
// exactly this action (Block 9), it was just never wired to this page.

const ACTIONS = ['approve', 'reject', 'suspend'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'finance:adjust:initiate');
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      userId?: string;
      tier?: number;
      reason?: string;
    };

    const action = body.action as Action;
    if (!ACTIONS.includes(action)) return errorResponse('action must be approve, reject or suspend', 400);
    const userId = String(body.userId || '');
    if (!userId) return errorResponse('userId is required', 400);

    let profile;
    let auditAction: string;
    let reason: string;

    if (action === 'approve') {
      const tier = (Number(body.tier ?? 1) as KycTier);
      profile = await approveKyc(userId, tier, identity.actorId);
      auditAction = 'fintech.kyc.approve';
      reason = `Approved KYC tier ${tier}`;
    } else if (action === 'reject') {
      reason = String(body.reason || 'Rejected by compliance review.');
      profile = await failKyc(userId, reason, identity.actorId);
      auditAction = 'fintech.kyc.reject';
    } else {
      reason = String(body.reason || 'Suspended by compliance review.');
      profile = await suspendKyc(userId, reason, identity.actorId);
      auditAction = 'fintech.kyc.suspend';
    }

    addAuditEvent({
      adminUser: identity.actorId,
      role: 'admin',
      action: auditAction,
      module: 'payments_finance',
      entityType: 'user_profile',
      entityId: userId,
      reason,
    });

    return successResponse({ profile });
  } catch (error) {
    return handleApiError(error, 'Failed to update KYC status');
  }
}
