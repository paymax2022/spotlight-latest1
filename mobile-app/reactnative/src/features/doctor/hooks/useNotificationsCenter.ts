// ── Doctor — Notifications Centre hooks (Batch 6, Section X) ─────────────────
// Query keys under ['doctor', 'notifications', …]. Mutations auto-generate the
// idempotencyKey. REUSES the Phase 1 useNotifications (useAccount.ts) for the
// plain feed; this file adds the RICH feed (kind/severity/cta), grouped view,
// preferences, and the mark-read / mark-all / update-prefs flows. Hook names are
// deliberately distinct from useNotifications to avoid a barrel collision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRichNotifications,
  getNotificationGroups,
  getNotificationPreferences,
  markNotificationRead,
  markAllNotificationsRead,
  updateNotificationPrefs,
  DEMO_RICH_NOTIFICATIONS,
  DEMO_NOTIFICATION_GROUPS,
  DEMO_NOTIFICATION_PREFERENCES,
} from '@/api/doctor.batch6.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  MarkNotificationReadInput,
  MarkAllNotificationsReadInput,
  UpdateNotificationPrefsInput,
} from '@/types/doctor.batch6';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useNotificationFeed() {
  return useQuery({
    queryKey:        ['doctor', 'notifications', 'rich'],
    queryFn:         getRichNotifications,
    placeholderData: DEMO_RICH_NOTIFICATIONS,
    staleTime:       15_000,
  });
}

export function useNotificationGroups() {
  return useQuery({
    queryKey:        ['doctor', 'notifications', 'groups'],
    queryFn:         getNotificationGroups,
    placeholderData: DEMO_NOTIFICATION_GROUPS,
    staleTime:       15_000,
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey:        ['doctor', 'notifications', 'preferences'],
    queryFn:         getNotificationPreferences,
    placeholderData: DEMO_NOTIFICATION_PREFERENCES,
    staleTime:       60_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MarkNotificationReadInput, 'idempotencyKey'>) =>
      markNotificationRead({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MarkAllNotificationsReadInput, 'idempotencyKey'>) =>
      markAllNotificationsRead({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'notifications'] });
    },
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateNotificationPrefsInput, 'idempotencyKey'>) =>
      updateNotificationPrefs({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'notifications', 'preferences'] });
    },
  });
}
