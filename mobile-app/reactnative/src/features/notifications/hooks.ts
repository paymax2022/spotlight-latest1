import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const notificationKeys = { all: ['notifications'] as const, list: () => [...notificationKeys.all, 'list'] as const };

export function useNotifications() { return useQuery({ queryKey: notificationKeys.list(), queryFn: api.listNotifications }); }

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.markRead(id), onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.list() }) });
}
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.markAllRead(), onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.list() }) });
}
