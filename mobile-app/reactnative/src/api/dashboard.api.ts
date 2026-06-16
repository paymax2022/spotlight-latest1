import { createSupabaseClient } from '@/lib/supabase';
import { mapTransactionFromSupabase } from '@/api/mappers/transaction.mapper';
import { getWallet } from '@/api/wallet.api';
import { Transaction } from '@/types/transaction';
import { Wallet } from '@/types/wallet';

export interface DashboardData {
  user: { fullName: string; phone: string };
  wallet: Wallet;
  services: { airtime: boolean; data: boolean; electricity: boolean; cableTv: boolean };
  recentTransactions: Transaction[];
  banners?: Array<{ id: string; imageUrl: string; title?: string; route?: string }>;
}

const TX_SELECT = `
  *,
  biller:utility_billers!biller_id(name),
  product:utility_products!product_id(name)
`.trim();

const FALLBACK_WALLET: Wallet = { balance: 0, currency: 'NGN', ledgerBalance: 0, pendingBalance: 0 };

export async function getDashboard(): Promise<DashboardData> {
  const supabase = createSupabaseClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  // Auth failure is fatal — caller should redirect to login.
  if (authErr || !user) throw new Error('Not authenticated');

  // Wallet and transaction fetches are non-fatal: a temporary API outage or
  // unconfigured Next.js server should not block the user from seeing their
  // profile and service grid.
  const [profileRes, walletResult, txRes] = await Promise.allSettled([
    supabase
      .from('user_profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .maybeSingle(),
    getWallet(),
    supabase
      .from('utility_transactions')
      .select(TX_SELECT)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const profile  = profileRes.status === 'fulfilled' ? profileRes.value.data : null;
  const wallet   = walletResult.status  === 'fulfilled' ? walletResult.value  : FALLBACK_WALLET;
  const txData   = txRes.status         === 'fulfilled' ? (txRes.value.data ?? []) : [];

  const fullName = String(profile?.full_name ?? user.email ?? '');
  const phone    = String(profile?.phone ?? '');

  return {
    user:               { fullName, phone },
    wallet,
    services:           { airtime: true, data: true, electricity: true, cableTv: true },
    recentTransactions: txData.map(mapTransactionFromSupabase),
  };
}
