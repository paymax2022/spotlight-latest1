// Paymax Connect — Networking React Query hooks (PRD §10.3 NW-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as networkingApi from './api';
import type { NetworkFilters, CreateCommunityInput, CreateEventInput, RsvpState } from './types';

export const networkingKeys = {
  all: ['connect', 'networking'] as const,
  feed: (f: NetworkFilters) => [...networkingKeys.all, 'feed', f] as const,
  profile: (id: string) => [...networkingKeys.all, 'profile', id] as const,
  endorsements: (id: string) => [...networkingKeys.all, 'endorsements', id] as const,
  communities: (q?: string) => [...networkingKeys.all, 'communities', q ?? ''] as const,
  community: (id: string) => [...networkingKeys.all, 'community', id] as const,
  events: (q?: string) => [...networkingKeys.all, 'events', q ?? ''] as const,
  event: (id: string) => [...networkingKeys.all, 'event', id] as const,
};

export function useNetworkFeed(filters: NetworkFilters) {
  return useQuery({ queryKey: networkingKeys.feed(filters), queryFn: () => networkingApi.getNetworkFeed(filters) });
}

export function useNetworkProfile(id: string) {
  return useQuery({ queryKey: networkingKeys.profile(id), queryFn: () => networkingApi.getNetworkProfile(id), enabled: !!id });
}

export function useSendConnectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; note: string }) => networkingApi.sendConnectRequest(v.profileId, v.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.all }),
  });
}

export function useEndorsements(id: string) {
  return useQuery({ queryKey: networkingKeys.endorsements(id), queryFn: () => networkingApi.getEndorsements(id), enabled: !!id });
}

export function useEndorseSkill(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skill: string) => networkingApi.endorseSkill(profileId, skill),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.endorsements(profileId) }),
  });
}

export function useCommunities(query?: string) {
  return useQuery({ queryKey: networkingKeys.communities(query), queryFn: () => networkingApi.getCommunities(query) });
}

export function useCommunity(id: string) {
  return useQuery({ queryKey: networkingKeys.community(id), queryFn: () => networkingApi.getCommunity(id), enabled: !!id });
}

export function useToggleJoinCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; join: boolean }) => networkingApi.toggleJoinCommunity(v.id, v.join),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.all }),
  });
}

export function useCreateCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommunityInput) => networkingApi.createCommunity(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.communities() }),
  });
}

export function useEvents(query?: string) {
  return useQuery({ queryKey: networkingKeys.events(query), queryFn: () => networkingApi.getEvents(query) });
}

export function useEvent(id: string) {
  return useQuery({ queryKey: networkingKeys.event(id), queryFn: () => networkingApi.getEvent(id), enabled: !!id });
}

export function useRsvpEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; state: RsvpState }) => networkingApi.rsvpEvent(v.id, v.state),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.all }),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => networkingApi.createEvent(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: networkingKeys.events() }),
  });
}
