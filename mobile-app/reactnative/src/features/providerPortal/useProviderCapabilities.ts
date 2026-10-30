// Which provider portals the signed-in user may open. Read-only; the backend
// derives it from the rows the caller owns (GET /health/provider-portal/me).

import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { HEALTH_API_BASE } from '@/features/health/constants/health.constants';
import { mapCapability, type ProviderCapability, type ProviderCapabilityWire } from './gate';

export async function getProviderCapabilities(): Promise<ProviderCapability[]> {
  const { data } = await api.get<{ capabilities?: ProviderCapabilityWire[] }>(`${HEALTH_API_BASE}/provider-portal/me`);
  return (data.capabilities ?? []).map(mapCapability);
}

export function useProviderCapabilities() {
  return useQuery({
    queryKey: ['provider-portal', 'capabilities'],
    queryFn: getProviderCapabilities,
    staleTime: 60_000,
  });
}
