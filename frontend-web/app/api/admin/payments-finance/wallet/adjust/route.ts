import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { creditWallet, debitWallet } from '@/src/server/wallet/service';

// ADMIN CONSOLIDATION (see docs/adr/ADR-047 and ../../route.ts's header): the
// original page's adjustWalletAction, ported with one deliberate fix.
//
// The original built its OWN idempotency key server-side from Date.now() +
// a fresh random UUID on every submit — so a genuine retry (double-click,
// a dropped response the browser resubmits) generated a NEW key each time
// and was never deduped by creditWallet/debitWallet's own idempotency check.
// CLAUDE.md's money-handling rule requires every mutation to carry a real
// Idempotency-Key; every other money-mutation route in this codebase reads
// it from the client via the Idempotency-Key header (see e.g.
// app/api/v1/estate/dues/[id]/pay/route.ts) rather than minting one
// server-side. This route follows that convention instead.
//
// Everything else — counterAccount: 'settlement' for both directions (ADR-040:
// manual admin movements settle against the platform pot, not a payment
// provider), the audit event shape — is unchanged from the original.

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'finance:adjust:initiate');

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for wallet adjustments.', 400);

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      direction?: string;
      amountKobo?: number;
      reason?: string;
    };

    const userId = String(body.userId || '');
    const direction = String(body.direction || '');
    const amountKobo = Number(body.amountKobo);
    const reason = String(body.reason || '').trim();

    if (!userId) return errorResponse('userId is required', 400);
    if (direction !== 'credit' && direction !== 'debit') return errorResponse('direction must be credit or debit', 400);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) return errorResponse('amountKobo must be a positive integer', 400);
    if (!reason) return errorResponse('reason is required for wallet adjustments', 400);

    const reference = `ADMIN-${direction.toUpperCase()}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const input = {
      amountKobo,
      reference,
      idempotencyKey,
      description: `Admin wallet ${direction}: ${reason}`,
      counterAccount: 'settlement' as const,
      metadata: {
        actor_id: identity.actorId,
        reason,
        source: 'admin_payments_finance',
      },
    };

    const result = direction === 'credit' ? await creditWallet(userId, input) : await debitWallet(userId, input);

    addAuditEvent({
      adminUser: identity.actorId,
      role: 'admin',
      action: direction === 'credit' ? 'fintech.wallet.credit' : 'fintech.wallet.debit',
      module: 'payments_finance',
      entityType: 'wallet',
      entityId: userId,
      reason: `${reason} (${(amountKobo / 100).toLocaleString('en-NG')} NGN)`,
      newValue: { userId, amountKobo, reference, direction, alreadyProcessed: result.alreadyProcessed },
    });

    return successResponse({ result, reference });
  } catch (error) {
    return handleApiError(error, 'Failed to adjust wallet');
  }
}
