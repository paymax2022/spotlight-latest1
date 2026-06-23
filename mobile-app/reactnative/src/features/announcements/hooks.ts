import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';
import type { CreateAnnouncementInput } from './api';

export const announcementKeys = {
  all: ['announcements'] as const,
  list: () => [...announcementKeys.all, 'list'] as const,
  detail: (id: string) => [...announcementKeys.all, 'detail', id] as const,
};

export function useAnnouncements() { return useQuery({ queryKey: announcementKeys.list(), queryFn: api.listAnnouncements }); }
export function useAnnouncement(id: string) { return useQuery({ queryKey: announcementKeys.detail(id), queryFn: () => api.getAnnouncement(id), enabled: !!id }); }

export function useMarkAnnouncementRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.markRead(id), onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.list() }) });
}
export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateAnnouncementInput, 'idempotencyKey'>) => api.createAnnouncement({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.list() }),
  });
}
