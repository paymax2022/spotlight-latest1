// ── Crowdfunding — Creator data hooks (Section F + G) ────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCreatorStats,
  getMyCampaigns,
  getCreatorContributions,
  getCreatorWithdrawals,
  getCreatorNotifications,
  getCampaignAnalytics,
  submitCampaign,
  updateCampaign,
  setCampaignPaused,
  deleteCampaign,
  requestCampaignFeature,
  withdrawCampaignFeatureRequest,
  unfeatureCampaign,
} from '../api/crowdfunding.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Campaign, CampaignDraftInput, CampaignEditInput } from '../types/crowdfunding.types';

const KEY = 'crowdfunding';

export function useCreatorStats() {
  return useQuery({ queryKey: [KEY, 'creator', 'stats'], queryFn: getCreatorStats, staleTime: 30_000 });
}

export function useMyCampaigns(status?: string) {
  return useQuery({
    queryKey: [KEY, 'creator', 'campaigns', status ?? 'all'],
    queryFn: () => getMyCampaigns(status),
    staleTime: 20_000,
  });
}

export function useCreatorContributions() {
  return useQuery({ queryKey: [KEY, 'creator', 'contributions'], queryFn: getCreatorContributions, staleTime: 20_000 });
}

export function useCreatorWithdrawals() {
  return useQuery({ queryKey: [KEY, 'creator', 'withdrawals'], queryFn: getCreatorWithdrawals, staleTime: 20_000 });
}

export function useCreatorNotifications() {
  return useQuery({ queryKey: [KEY, 'creator', 'notifications'], queryFn: getCreatorNotifications, staleTime: 20_000 });
}

export function useCampaignAnalytics(id?: string) {
  return useQuery({
    queryKey: [KEY, 'creator', 'analytics', id],
    queryFn: () => getCampaignAnalytics(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useSubmitCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, submitForReview }: { draft: CampaignDraftInput; submitForReview: boolean }) =>
      submitCampaign(draft, submitForReview, generateIdempotencyKey()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'campaigns'] });
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'stats'] });
    },
  });
}

// ─── Owner self-management (Section G2) ───────────────────────────────────────

/**
 * A single campaign the caller owns, read out of the creator list.
 *
 * There is no per-campaign owner GET in the contract, so this reuses the "all"
 * list query the rest of the creator surface already holds — same cache entry,
 * so a mutation that refreshes the list refreshes this too, and there is no
 * second request per screen. (The performance screen does the same thing
 * inline; this just names it.)
 */
export function useMyCampaign(id?: string) {
  const query = useMyCampaigns();
  const campaign = id ? (query.data ?? []).find((c) => c.id === id) : undefined;
  return { ...query, campaign };
}

/**
 * Fall back to the creator's own most-recently-created campaign when a
 * screen has no campaign in its route (e.g. a bare wallet/ledger entry
 * point). `getMyCampaigns` is server-ordered newest-first, so `[0]` is that
 * campaign — never a guess made client-side.
 *
 * `isLoading` distinguishes "still resolving" (list not back yet) from a
 * genuinely campaign-less creator (`id` stays undefined once loaded) — a
 * caller that only checked `id` couldn't tell those apart and would flash an
 * error state during the resolve.
 */
export function useDefaultCampaignId(): { id: string | undefined; isLoading: boolean } {
  const query = useMyCampaigns();
  return { id: query.data?.[0]?.id, isLoading: query.isLoading };
}

/**
 * Write the campaign the SERVER returned into the creator caches, then mark
 * them stale.
 *
 * Deliberately not an optimistic update: nothing is written before the request
 * resolves, and what lands is the server's own representation — so a refused
 * write leaves the previous state on screen instead of a local guess that looks
 * like it succeeded. The invalidate that follows re-reads from the server, so
 * even a partial response converges.
 */
function useApplyServerCampaign() {
  const qc = useQueryClient();
  return (updated: Campaign) => {
    qc.setQueriesData<Campaign[]>({ queryKey: [KEY, 'creator', 'campaigns'] }, (old) =>
      old ? old.map((c) => (c.id === updated.id ? updated : c)) : old,
    );
    qc.invalidateQueries({ queryKey: [KEY, 'creator', 'campaigns'] });
    qc.invalidateQueries({ queryKey: [KEY, 'creator', 'stats'] });
    // Pausing/unfeaturing changes what public discovery shows.
    qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
  };
}

export function useUpdateCampaign(id?: string) {
  const apply = useApplyServerCampaign();
  return useMutation({
    mutationFn: (patch: CampaignEditInput) => updateCampaign(id as string, patch),
    onSuccess: apply,
  });
}

export function useSetCampaignPaused(id?: string) {
  const apply = useApplyServerCampaign();
  return useMutation({
    mutationFn: (paused: boolean) => setCampaignPaused(id as string, paused),
    onSuccess: apply,
  });
}

export function useDeleteCampaign(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteCampaign(id as string),
    onSuccess: () => {
      // Drop it from the cached lists only AFTER the server confirmed the
      // delete, then re-read — a 409 must leave the campaign visible.
      qc.setQueriesData<Campaign[]>({ queryKey: [KEY, 'creator', 'campaigns'] }, (old) =>
        old ? old.filter((c) => c.id !== id) : old,
      );
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'campaigns'] });
      qc.invalidateQueries({ queryKey: [KEY, 'creator', 'stats'] });
      qc.invalidateQueries({ queryKey: [KEY, 'campaigns'] });
    },
  });
}

export function useRequestCampaignFeature(id?: string) {
  const apply = useApplyServerCampaign();
  return useMutation({ mutationFn: () => requestCampaignFeature(id as string), onSuccess: apply });
}

export function useWithdrawCampaignFeatureRequest(id?: string) {
  const apply = useApplyServerCampaign();
  return useMutation({ mutationFn: () => withdrawCampaignFeatureRequest(id as string), onSuccess: apply });
}

export function useUnfeatureCampaign(id?: string) {
  const apply = useApplyServerCampaign();
  return useMutation({ mutationFn: () => unfeatureCampaign(id as string), onSuccess: apply });
}
