// ── Schedule your logistics movement — data hooks ────────────────────────────
// React Query hooks over scheduled.api.ts, mirroring useMobility.ts / useModes.ts
// so screens stay declarative and share caching / loading / error contracts.
// Create + cancel use a PERSISTED Idempotency-Key (see getOrCreateIdempotencyKey
// in scheduled.api.ts) so an app-kill mid-request retries with the same key
// instead of risking a duplicate booking or duplicate cancel side-effect.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as scheduled from '../api/scheduled.api';
import { toMobilityError } from '../utils/mobilityFormatters';
import type {
  CreateScheduledRequest,
  EstimateScheduledRequest,
  ListScheduledParams,
  RescheduleRequest,
  ScheduledFilter,
} from '../api/scheduled.api';

export const SCHEDULED_KEY = 'scheduled';

// ─── List (upcoming | past | all) ───────────────────────────────────────────
export function useScheduledList(filter: ScheduledFilter = 'upcoming', params?: Omit<ListScheduledParams, 'filter'>) {
  return useQuery({
    queryKey: [SCHEDULED_KEY, 'list', filter, params?.cursor ?? null, params?.limit ?? null],
    queryFn: () => scheduled.listScheduled({ filter, ...params }),
    staleTime: 15_000,
  });
}

// ─── Detail (poll while in-flight states so the FSM advances on screen) ─────
const LIVE_STATUSES = new Set(['dispatch_pending', 'dispatched']);

export function useScheduledDetail(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [SCHEDULED_KEY, 'detail', id],
    queryFn: () => scheduled.getScheduled(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      if (!options?.poll) return false;
      const status = query.state.data?.status;
      return status && LIVE_STATUSES.has(status) ? 5_000 : false;
    },
    staleTime: 3_000,
  });
}

// ─── Estimate (live fare quote while composing the booking) ────────────────
export function useScheduledEstimate() {
  return useMutation({
    mutationFn: (req: EstimateScheduledRequest) => scheduled.estimateScheduled(req),
    onError: (e) => { throw toMobilityError(e); },
  });
}

// ─── Create ──────────────────────────────────────────────────────────────────
// `draftScope` identifies the in-progress draft (e.g. a per-screen-mount token)
// so its persisted Idempotency-Key survives an app kill and is cleared only
// once the create has definitively resolved.
export function useCreateScheduled(draftScope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: CreateScheduledRequest) => {
      const idempotencyKey = await scheduled.getOrCreateIdempotencyKey(draftScope, 'sched-create');
      try {
        const result = await scheduled.createScheduled(req, idempotencyKey);
        await scheduled.clearIdempotencyKey(draftScope);
        return result;
      } catch (e) {
        // Keep the persisted key on failure so a retry (including after an app
        // kill) reuses it — the backend then treats the retry as the same
        // logical request instead of creating a duplicate booking.
        throw toMobilityError(e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SCHEDULED_KEY, 'list'] });
    },
  });
}

// ─── Reschedule / edit (only while status === 'scheduled') ─────────────────
export function useRescheduleScheduled(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: RescheduleRequest) => scheduled.rescheduleScheduled(id as string, req),
    onError: (e) => { throw toMobilityError(e); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SCHEDULED_KEY, 'list'] });
      if (id) qc.invalidateQueries({ queryKey: [SCHEDULED_KEY, 'detail', id] });
    },
  });
}

// ─── Cancel ──────────────────────────────────────────────────────────────────
export function useCancelScheduled(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason?: string) => {
      if (!id) throw new Error('Missing scheduled booking id');
      const scope = `cancel-${id}`;
      const idempotencyKey = await scheduled.getOrCreateIdempotencyKey(scope, 'sched-cancel');
      try {
        const result = await scheduled.cancelScheduled(id, idempotencyKey, reason);
        await scheduled.clearIdempotencyKey(scope);
        return result;
      } catch (e) {
        throw toMobilityError(e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SCHEDULED_KEY, 'list'] });
      if (id) qc.invalidateQueries({ queryKey: [SCHEDULED_KEY, 'detail', id] });
    },
  });
}
