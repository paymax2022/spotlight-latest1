import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getVirtualAccount } from '@/src/server/virtual-accounts/service';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  if (!featureFlags.virtualAccounts()) {
    return errorResponse('Virtual accounts feature is not available.', 503);
  }

  try {
    const user = await requireRequestUser(request);
    await requireKycTier(user.id, 1);

    const account = await getVirtualAccount(user.id);

    return NextResponse.json({
      success: true,
      account: account
        ? {
            account_number: account.account_number,
            account_name: account.account_name,
            bank_name: account.bank_name,
            bank_code: account.bank_code,
            currency: account.currency,
            provisioned_at: account.provisioned_at,
          }
        : null,
      provisioned: account !== null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
