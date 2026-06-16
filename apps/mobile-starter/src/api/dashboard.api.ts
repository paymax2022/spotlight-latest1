import { api } from '@/api/client';
import { mapTransactionFromApi } from '@/api/mappers/transaction.mapper';
import { Dashboard } from '@/types/billing';

export async function getDashboard(): Promise<Dashboard> {
  const response = await api.get('/api/dashboard');
  const data = response.data?.data ?? response.data;

  // Wallet is returned as available_kobo; convert to naira for display
  const availableKobo = data?.wallet?.available_kobo;
  const balanceNaira = availableKobo != null ? Number(availableKobo) / 100 : Number(data?.wallet?.balance ?? 0);

  return {
    user: {
      fullName: String(data?.user?.fullName ?? data?.user?.full_name ?? ''),
      phone: String(data?.user?.phone ?? ''),
    },
    wallet: {
      balance: balanceNaira,
      currency: (data?.wallet?.currency ?? 'NGN') as Dashboard['wallet']['currency'],
    },
    services: {
      airtime: Boolean(data?.services?.airtime ?? true),
      data: Boolean(data?.services?.data ?? true),
      electricity: Boolean(data?.services?.electricity ?? true),
      cableTv: Boolean(data?.services?.cableTv ?? true),
    },
    recentTransactions: (data?.recentTransactions ?? []).map(mapTransactionFromApi),
    banners: data?.banners ?? [],
  };
}
