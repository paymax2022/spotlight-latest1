import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { getOrCreateAccount } from '@/src/server/wallet/service';

// ADMIN CONSOLIDATION (see ../../route.ts's header): the original page's
// backfillWalletsAction, ported one-to-one. Not a money movement (no ledger
// entry posted — getOrCreateAccount only ensures a ledger_accounts row
// exists), but it does mutate state, so it stays behind the same
// 'finance:adjust:initiate' gate as the other write actions here.

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'finance:adjust:initiate');

    const supabase = createAdminClient();
    const { data } = await supabase.from('user_profiles').select('id').limit(500);
    const profiles = (data ?? []) as Array<{ id: string }>;

    let processed = 0;
    for (const profile of profiles) {
      if (!profile.id) continue;
      await getOrCreateAccount(profile.id);
      processed += 1;
    }

    addAuditEvent({
      adminUser: identity.actorId,
      role: 'admin',
      action: 'fintech.wallet.backfill',
      module: 'payments_finance',
      entityType: 'ledger_account',
      reason: `Ensured wallet accounts for ${processed} profiles`,
    });

    return successResponse({ processed });
  } catch (error) {
    return handleApiError(error, 'Failed to backfill wallets');
  }
}
