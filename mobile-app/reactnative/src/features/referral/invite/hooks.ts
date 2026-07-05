// ── Referral Invite & Share React Query hooks (v5) ───────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as inviteApi from './api';
import { referralKeys } from '../foundation/hooks';
import type { ShareContext, VanityLinkInput } from './types';

export const inviteKeys = {
  share: () => [...referralKeys.all, 'invite', 'share'] as const,
  contacts: () => [...referralKeys.all, 'invite', 'contacts'] as const,
  vanity: () => [...referralKeys.all, 'invite', 'vanity'] as const,
  contextual: (c: ShareContext) => [...referralKeys.all, 'invite', 'contextual', c] as const,
  tracking: () => [...referralKeys.all, 'invite', 'tracking'] as const,
  verticals: () => [...referralKeys.all, 'invite', 'verticals'] as const,
};

export function useSharePayload() {
  return useQuery({
    queryKey: inviteKeys.share(),
    queryFn: inviteApi.getSharePayload,
    staleTime: 60_000,
  });
}

export function useContacts() {
  return useQuery({
    queryKey: inviteKeys.contacts(),
    queryFn: inviteApi.getContacts,
    staleTime: 60_000,
  });
}

export function useInviteContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => inviteApi.inviteContacts(ids),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: inviteKeys.tracking() });
        qc.invalidateQueries({ queryKey: inviteKeys.contacts() });
      }
    },
  });
}

export function useVanityLinks() {
  return useQuery({
    queryKey: inviteKeys.vanity(),
    queryFn: inviteApi.getVanityLinks,
    staleTime: 30_000,
  });
}

export function useCreateVanityLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VanityLinkInput) => inviteApi.createVanityLink(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: inviteKeys.vanity() }),
  });
}

export function useContextualPrompt(context: ShareContext) {
  return useQuery({
    queryKey: inviteKeys.contextual(context),
    queryFn: () => inviteApi.getContextualPrompt(context),
    staleTime: 60_000,
  });
}

export function useTrackedInvitees() {
  return useQuery({
    queryKey: inviteKeys.tracking(),
    queryFn: inviteApi.getTrackedInvitees,
    staleTime: 30_000,
  });
}

export function useNudgeInvitee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => inviteApi.nudgeInvitee(id),
    onSuccess: (res) => {
      if (res.ok) qc.invalidateQueries({ queryKey: inviteKeys.tracking() });
    },
  });
}

export function useVerticals() {
  return useQuery({
    queryKey: inviteKeys.verticals(),
    queryFn: inviteApi.getVerticals,
    staleTime: 5 * 60_000,
  });
}
