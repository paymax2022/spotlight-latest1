import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { JobStatus } from './api';

export const vendorKeys = {
  all: ['vendors'] as const,
  list: () => [...vendorKeys.all, 'list'] as const,
  jobs: () => [...vendorKeys.all, 'jobs'] as const,
};

export function useVendors() { return useQuery({ queryKey: vendorKeys.list(), queryFn: api.listVendors }); }
export function useVendorJobs() { return useQuery({ queryKey: vendorKeys.jobs(), queryFn: api.listJobs }); }

export function useUpdateJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) => api.updateJobStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorKeys.jobs() }),
  });
}
