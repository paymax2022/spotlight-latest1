/**
 * GET /api/dashboard
 *
 * Aggregates wallet balance + auth user profile + recent utility transactions
 * into a single response for the mobile home screen.
 * Requires Bearer token.
 */
import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { getBalance } from '@/src/server/wallet/service';
import { listUserUtilityTransactions } from '@/src/server/utility/service';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    // Fetch user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .maybeSingle();

    // Fetch wallet balance (only if wallet feature is enabled)
    let walletBalance = { available_kobo: 0, currency: 'NGN' };
    if (featureFlags.wallet()) {
      try {
        const balance = await getBalance(user.id);
        walletBalance = { available_kobo: balance.available_kobo, currency: balance.currency };
      } catch {
        // Wallet errors should not break the dashboard
      }
    }

    // Fetch recent utility transactions (only if utility payments enabled)
    let recentTransactions: unknown[] = [];
    if (featureFlags.utilityPayments()) {
      try {
        recentTransactions = await listUserUtilityTransactions(user.id, { limit: 5 });
      } catch {
        // Transaction errors should not break the dashboard
      }
    }

    return NextResponse.json({
      user: {
        fullName: (profile as { full_name?: string } | null)?.full_name ?? '',
        phone: (profile as { phone?: string } | null)?.phone ?? '',
        email: user.email ?? '',
      },
      wallet: {
        available_kobo: walletBalance.available_kobo,
        currency: walletBalance.currency,
      },
      recentTransactions,
      services: {
        airtime: featureFlags.utilityPayments(),
        data: featureFlags.utilityPayments(),
        electricity: featureFlags.utilityPayments(),
        cableTv: featureFlags.utilityPayments(),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
