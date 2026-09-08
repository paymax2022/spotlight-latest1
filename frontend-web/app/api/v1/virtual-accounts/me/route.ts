import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getOrProvisionVirtualAccount } from '@/src/server/virtual-accounts/service';
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
    });
  } catch (err) {
    return handleApiError(err);
  }
}
