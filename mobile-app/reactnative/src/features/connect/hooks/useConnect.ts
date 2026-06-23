import { useQuery } from '@tanstack/react-query';
import { getConnectConfig } from '../api/connect.api';

export const connectKeys = {
  all: ['connect'] as const,
  config: () => [...connectKeys.all, 'config'] as const,
};

// useConnectConfig fetches backend-owned config (mock-first in Phase 0).
export function useConnectConfig() {
  return useQuery({
    queryKey: connectKeys.config(),
    queryFn: getConnectConfig,
  });
}
