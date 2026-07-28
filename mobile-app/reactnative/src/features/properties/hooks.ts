import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const propertyKeys = {
  all: ['properties'] as const,
  list: () => [...propertyKeys.all, 'list'] as const,
  detail: (id: string) => [...propertyKeys.all, 'detail', id] as const,
  analytics: (id: string) => [...propertyKeys.all, 'analytics', id] as const,
};

export function useProperties() {
  return useQuery({ queryKey: propertyKeys.list(), queryFn: api.listProperties });
}

export function useProperty(id: string) {
  return useQuery({ queryKey: propertyKeys.detail(id), queryFn: () => api.getProperty(id), enabled: !!id });
}

export function usePropertyAnalytics(id: string) {
  return useQuery({ queryKey: propertyKeys.analytics(id), queryFn: () => api.getPropertyAnalytics(id), enabled: !!id });
}

export function useRequestPropertyTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toUserId, transferType, reason }: { id: string; toUserId: string; transferType: 'ownership' | 'tenancy'; reason?: string }) =>
      api.requestPropertyTransfer(id, { toUserId, transferType, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.all }),
  });
}
