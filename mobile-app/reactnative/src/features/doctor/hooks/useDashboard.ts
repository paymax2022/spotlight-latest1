// ── Doctor — Batch 1 · Section D · dashboard hooks ────────────────────────────
// The dashboard aggregate (counts + previews + alerts), the platform
// announcement, presence toggle and announcement dismissal. Reads use the
// DEMO_* exports as placeholderData; mutations auto-generate the Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDashboard,
  getAnnouncement,
  setPresence,
  dismissAnnouncement,
  DEMO_DASHBOARD,
  DEMO_ANNOUNCEMENT,
} from '@/api/doctor.batch1.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  SetPresenceInput,
  DismissAnnouncementInput,
} from '@/types/doctor.batch1';

export function useDashboard() {
  return useQuery({
    queryKey:        ['doctor', 'dashboard'],
    queryFn:         getDashboard,
    placeholderData: DEMO_DASHBOARD,
    staleTime:       15_000,
  });
}

export function useAnnouncement() {
  return useQuery({
    queryKey:        ['doctor', 'dashboard', 'announcement'],
    queryFn:         getAnnouncement,
    placeholderData: DEMO_ANNOUNCEMENT,
    staleTime:       60_000,
  });
}

export function useSetPresence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetPresenceInput, 'idempotencyKey'>) =>
      setPresence({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'dashboard'] });
    },
  });
}

export function useDismissAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DismissAnnouncementInput, 'idempotencyKey'>) =>
      dismissAnnouncement({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'dashboard', 'announcement'] });
      qc.invalidateQueries({ queryKey: ['doctor', 'dashboard'] });
    },
  });
}
