// ── Marketplace — Trust & Account React Query hooks ──────────────────────────
// Query keys namespaced under ['mkt','account',…]; mutations invalidate the
// relevant queries. Kept in the api/ folder next to account.api.ts so the Account
// screens import everything from one place without touching the foundation hooks.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as accountApi from './account.api';
import type { NotificationPrefsPatch } from './account.api';

export const MKT_ACCOUNT_KEYS = {
  blocks: ['mkt', 'account', 'blocks'] as const,
  notificationPrefs: ['mkt', 'account', 'notification-prefs'] as const,
  safeSpots: (filter?: { state?: string; lga?: string }) => ['mkt', 'account', 'safe-spots', filter ?? null] as const,
};

// ── Blocked users (§32) ───────────────────────────────────────────────────────
export const useBlocks = () =>
  useQuery({ queryKey: MKT_ACCOUNT_KEYS.blocks, queryFn: accountApi.listBlocks });

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { blockedUserId: string; blockedUserName?: string }) =>
      accountApi.blockUser(input.blockedUserId, input.blockedUserName),
    onSuccess: () => qc.invalidateQueries({ queryKey: MKT_ACCOUNT_KEYS.blocks }),
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => accountApi.unblockUser(blockId),
    onSuccess: () => qc.invalidateQueries({ queryKey: MKT_ACCOUNT_KEYS.blocks }),
  });
}

// ── Notification preferences (§33) ────────────────────────────────────────────
export const useNotificationPrefs = () =>
  useQuery({ queryKey: MKT_ACCOUNT_KEYS.notificationPrefs, queryFn: accountApi.getNotificationPrefs });

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPrefsPatch) => accountApi.updateNotificationPrefs(patch),
    // Optimistic: reflect the toggle instantly, roll back on error.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: MKT_ACCOUNT_KEYS.notificationPrefs });
      const prev = qc.getQueryData(MKT_ACCOUNT_KEYS.notificationPrefs);
      qc.setQueryData(MKT_ACCOUNT_KEYS.notificationPrefs, (old: unknown) =>
        old ? { ...(old as object), ...patch } : old,
      );
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(MKT_ACCOUNT_KEYS.notificationPrefs, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MKT_ACCOUNT_KEYS.notificationPrefs }),
  });
}

// ── Reports (§31) ─────────────────────────────────────────────────────────────
export function useCreateReport() {
  return useMutation({ mutationFn: accountApi.createReport });
}

// ── Meetup safe-spots (§27, used by Transact) ─────────────────────────────────
export const useSafeSpots = (filter?: { state?: string; lga?: string }) =>
  useQuery({ queryKey: MKT_ACCOUNT_KEYS.safeSpots(filter), queryFn: () => accountApi.getSafeSpots(filter), staleTime: 10 * 60_000 });
