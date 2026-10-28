import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { InboxParams, RetentionPolicyPatch } from './api';

export const notificationKeys = {
  all: ['notifications'] as const,
  // The key carries the selector, so the inbox page and the archived page are two cache entries rather
  // than one list that flips underneath a scroll.
  list: (params?: InboxParams) => [...notificationKeys.all, 'list', params ?? {}] as const,
  retention: () => [...notificationKeys.all, 'retention'] as const,
};

export function useNotifications(params?: InboxParams) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => api.listNotifications(params),
  });
}

function useInboxMutations() {
  const qc = useQueryClient();
  // Every one of these changes which rows match which view (archived moves a row out of the inbox, a pin
  // reorders it), so the whole feed is invalidated rather than just the current page.
  return () => qc.invalidateQueries({ queryKey: notificationKeys.all });
}

export function useMarkNotificationRead() {
  const invalidate = useInboxMutations();
  return useMutation({ mutationFn: (id: string) => api.markRead(id), onSuccess: invalidate });
}
export function useMarkAllNotificationsRead() {
  const invalidate = useInboxMutations();
  return useMutation({ mutationFn: () => api.markAllRead(), onSuccess: invalidate });
}
export function useSetNotificationArchived() {
  const invalidate = useInboxMutations();
  return useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.setArchived(id, archived), onSuccess: invalidate });
}
export function useSetNotificationPinned() {
  const invalidate = useInboxMutations();
  return useMutation({ mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.setPinned(id, pinned), onSuccess: invalidate });
}

export function useRetentionPolicy() {
  return useQuery({ queryKey: notificationKeys.retention(), queryFn: api.getRetentionPolicy });
}
export function useSetRetentionPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: RetentionPolicyPatch) => api.setRetentionPolicy(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.retention() }),
  });
}
export function useRunNotificationRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.runRetention(),
    // The sweep moves rows the recipient can see, so both the policy and the feed are stale after it.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
