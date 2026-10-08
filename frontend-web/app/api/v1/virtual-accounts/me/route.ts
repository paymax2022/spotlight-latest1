import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getOrProvisionVirtualAccount } from '@/src/server/virtual-accounts/service';
import { reconcileDvaInboundTransfers } from '@/src/server/virtual-accounts/reconcile';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  if (!featureFlags.virtualAccounts()) {
    return errorResponse('Virtual accounts feature is not available.', 503);
  }

  try {
    const user = await requireRequestUser(request);
    await requireKycTier(user.id, 1);

    // Provisions on first call rather than requiring a separate step — a
    // Tier-1 user who has never hit this endpoint before had no other way to
    // ever get an account number (nothing else in the codebase calls
    // provisionVirtualAccount). See getOrProvisionVirtualAccount's doc comment.
    const account = await getOrProvisionVirtualAccount(user.id, user.email);

    // AUD-FE-004 residual: inbound DVA credits were webhook-only — a dropped
    // charge.success left real collected money uncredited with no recovery
    // path. Verify-on-read: this is the read a client already polls for, so
    // reconcile the account's recent Paystack transactions against the ledger
    // here, crediting any the webhook missed through the same
    // dva:<reference>:CREDIT idempotency key. Best-effort and fail-open — a
    // Paystack hiccup must never break the account read.
    const reconciled = await reconcileDvaInboundTransfers(account).catch(() => ({
      checked: 0,
      credited: 0,
    }));

    return NextResponse.json({
      success: true,
      account: {
        account_number: account.account_number,
        account_name: account.account_name,
        bank_name: account.bank_name,
        bank_code: account.bank_code,
        currency: account.currency,
        provisioned_at: account.provisioned_at,
      },
      provisioned: true,
      reconciled_inbound_transfers: reconciled.credited,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
