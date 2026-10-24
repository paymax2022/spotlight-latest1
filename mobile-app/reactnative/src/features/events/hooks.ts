import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { applyLikeToggle, applyFollowToggle, type ToggleState } from './social';
import type { EventDetail, OrganiserProfile, EventPatch, TierPatch, PromoPatch, CreatePromoInput, IssueCompInput, AnnounceInput, AddTierInput, CreateEventInput, PurchaseTicketInput, GiftTicketInput, TopUpSource, GateToken, Gate, AddTeamMemberInput } from './types';

// Exported so useEventsRealtime (realtime/useEventsRealtime.ts) can invalidate
// the exact same query keys on a push, rather than duplicating the shape.
export const KEYS = {
  events:    (params?: { category?: string; state?: string }) => ['events', 'list', params ?? {}] as const,
  event:     (id: string) => ['events', 'event', id] as const,
  tickets:   ['events', 'tickets'] as const,
  ticket:    (id: string) => ['events', 'ticket', id] as const,
  ticketToken: (id: string) => ['events', 'ticket', id, 'token'] as const,
  wallet:    (walletId: string) => ['events', 'wallet', walletId] as const,
  walletEntries: (walletId: string) => ['events', 'wallet', walletId, 'entries'] as const,
  vendors:   (id: string) => ['events', 'vendors', id] as const,
  venue:     (id: string) => ['events', 'venue', id] as const,
  organiser: ['events', 'organiser'] as const,
  attendees: (id: string) => ['events', 'attendees', id] as const,
  team:      (id: string) => ['events', 'team', id] as const,
  // Public organiser page (events-social). Deliberately not under KEYS.organiser,
  // which is the caller's own dashboard, so invalidating one never refetches the other.
  organiserProfile: (id: string) => ['events', 'organiser-profile', id] as const,
  // KEYS.followingAll is the prefix that invalidates every page of the feed.
  followingAll: ['events', 'following'] as const,
  following: (limit: number, offset: number) => ['events', 'following', { limit, offset }] as const,
};

export const useEvents = (params?: { category?: string; state?: string }) =>
  useQuery({ queryKey: KEYS.events(params), queryFn: () => api.listEvents(params) });

export const useEvent = (id: string) =>
  useQuery({ queryKey: KEYS.event(id), queryFn: () => api.getEvent(id), enabled: !!id });

export const useMyTickets = () =>
  useQuery({ queryKey: KEYS.tickets, queryFn: api.listMyTickets });

export const useTicket = (id: string) =>
  useQuery({ queryKey: KEYS.ticket(id), queryFn: () => api.getTicket(id), enabled: !!id });

// Polls just under the server's 30s RotateTTL so the rendered QR/pass changes on
// the same schedule the gate's window-staleness check enforces.
export const useTicketToken = (id: string) =>
  useQuery({
    queryKey: KEYS.ticketToken(id),
    queryFn: () => api.getTicketToken(id),
    enabled: !!id,
    refetchInterval: 25_000,
    staleTime: 0,
  });

// walletId is the EventWallet.id (not the eventId) — screens must open the
// wallet first (useOpenEventWallet) and pass its id down.
export const useEventWallet = (walletId: string) =>
  useQuery({ queryKey: KEYS.wallet(walletId), queryFn: () => api.getEventWallet(walletId), enabled: !!walletId });

export const useWalletEntries = (walletId: string) =>
  useQuery({ queryKey: KEYS.walletEntries(walletId), queryFn: () => api.listWalletEntries(walletId), enabled: !!walletId });

export const useVendors = (eventId: string) =>
  useQuery({ queryKey: KEYS.vendors(eventId), queryFn: () => api.listVendors(eventId), enabled: !!eventId });

export const useVenueMap = (eventId: string) =>
  useQuery({ queryKey: KEYS.venue(eventId), queryFn: () => api.getVenueMap(eventId), enabled: !!eventId });

// Polls as the safety net for useEventsRealtime's SSE push (which is opt-in
// via EXPO_PUBLIC_REALTIME_ENABLED and may be off) — SSE is an accelerator,
// this poll is what actually guarantees the dashboard goes stale.
export const useOrganiserEvents = () =>
  useQuery({ queryKey: KEYS.organiser, queryFn: api.listOrganiserEvents, refetchInterval: 30_000 });

// Same safety-net reasoning as useOrganiserEvents above — this is the roster
// a steward is actively checking people in against, so it polls faster.
export const useAttendees = (eventId: string) =>
  useQuery({ queryKey: KEYS.attendees(eventId), queryFn: () => api.listAttendees(eventId), enabled: !!eventId, refetchInterval: 15_000 });

export function usePurchaseTickets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PurchaseTicketInput) => api.purchaseTickets(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.tickets });
      qc.invalidateQueries({ queryKey: ['events', 'list'] });
    },
  });
}

export function useGiftTicket(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cashtag: string) => api.giftTicket({ ticketId, cashtag } as GiftTicketInput),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.ticket(ticketId) });
      qc.invalidateQueries({ queryKey: KEYS.tickets });
    },
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.organiser });
      qc.invalidateQueries({ queryKey: ['events', 'list'] });
    },
  });
}

// Opens (or fetches) the caller's per-event wallet — returns its walletId for
// subsequent balance/top-up/charge/close calls.
export function useOpenEventWallet(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.openEventWallet(eventId),
    onSuccess: (wallet) => qc.setQueryData(KEYS.wallet(wallet.id), wallet),
  });
}

export function useTopUpEventWallet(walletId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ amountKobo, source }: { amountKobo: number; source?: TopUpSource }) =>
      api.topUpEventWallet(walletId, amountKobo, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.wallet(walletId) });
      qc.invalidateQueries({ queryKey: KEYS.walletEntries(walletId) });
    },
  });
}

export function useChargeVendor(walletId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { vendorId: string; amountKobo: number }) =>
      api.chargeVendor(args.vendorId, walletId, args.amountKobo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.wallet(walletId) });
      qc.invalidateQueries({ queryKey: KEYS.walletEntries(walletId) });
    },
  });
}

export function useCloseEventWallet(walletId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.closeEventWallet(walletId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.wallet(walletId) }),
  });
}

export function useValidateScan() {
  return useMutation({
    mutationFn: ({ token, gate }: { token: GateToken; gate: Gate }) => api.validateScan(token, gate),
  });
}

// ── Organiser lifecycle mutations ────────────────────────────────────────────
function useInvalidateOrganiserEvent() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: KEYS.organiser });
    qc.invalidateQueries({ queryKey: ['events', 'list'] });
    if (id) qc.invalidateQueries({ queryKey: KEYS.event(id) });
  };
}

export function useUpdateEvent(id: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: (patch: EventPatch) => api.updateEvent(id, patch),
    onSuccess: () => invalidate(id),
  });
}

export function useDuplicateEvent(id: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: () => api.duplicateEvent(id),
    onSuccess: () => invalidate(),
  });
}

export function usePauseEvent(id: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: () => api.pauseEvent(id),
    onSuccess: () => invalidate(id),
  });
}

export function useResumeEvent(id: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: () => api.resumeEvent(id),
    onSuccess: () => invalidate(id),
  });
}

// idemKey is supplied by the caller (one per user intent) so a retry of the
// same cancel replays instead of double-refunding.
export function useCancelEvent(id: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: ({ reason, idemKey }: { reason: string; idemKey: string }) =>
      api.cancelEvent(id, reason, idemKey),
    onSuccess: () => invalidate(id),
  });
}

// ── Comps / announcements ────────────────────────────────────────────────────
// idemKey is supplied by the caller (one per user intent) so a retry replays
// instead of double-issuing / double-sending.
export function useIssueComp(eventId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: ({ input, idemKey }: { input: IssueCompInput; idemKey: string }) =>
      api.issueComp(eventId, input, idemKey),
    onSuccess: () => {
      invalidate(eventId);
      qc.invalidateQueries({ queryKey: KEYS.attendees(eventId) });
    },
  });
}

export function useAnnounce(eventId: string) {
  return useMutation({
    mutationFn: ({ input, idemKey }: { input: AnnounceInput; idemKey: string }) =>
      api.announce(eventId, input, idemKey),
  });
}

// ── Tier/promo management (FEATURE_EVENTS_TICKETING_DEPTH) ───────────────────
export function useUpdateTier(eventId: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: ({ tierId, patch }: { tierId: string; patch: TierPatch }) => api.updateTier(eventId, tierId, patch),
    onSuccess: () => invalidate(eventId),
  });
}

export function useUpdatePromo(eventId: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: ({ promoId, patch }: { promoId: string; patch: PromoPatch }) => api.updatePromo(eventId, promoId, patch),
    onSuccess: () => invalidate(eventId),
  });
}

export const useTeam = (eventId: string) =>
  useQuery({ queryKey: KEYS.team(eventId), queryFn: () => api.listTeam(eventId), enabled: !!eventId });

export function useAddTeamMember(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddTeamMemberInput) => api.addTeamMember(eventId, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.team(eventId) }); },
  });
}

export function useRemoveTeamMember(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeTeamMember(eventId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.team(eventId) }); },
  });
}

export function useAddTier(eventId: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: (input: AddTierInput) => api.addTicketTier(eventId, input),
    onSuccess: () => invalidate(eventId),
  });
}

export function useCreatePromo(eventId: string) {
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: (input: CreatePromoInput) => api.createPromo(eventId, input),
    onSuccess: () => invalidate(eventId),
  });
}

// ── Social: likes, follows, organiser profile, following feed (events-social) ─
export const useOrganiser = (organiserId: string) =>
  useQuery({ queryKey: KEYS.organiserProfile(organiserId), queryFn: () => api.getOrganiser(organiserId), enabled: !!organiserId });

export const useFollowingEvents = (limit = 20, offset = 0) =>
  useQuery({ queryKey: KEYS.following(limit, offset), queryFn: () => api.listFollowingEvents(limit, offset) });

const NOT_LOADED: ToggleState = { liked: false, count: 0 };

// Like state lives on the event detail, so this shares the cache entry (and the
// single fetch) with useEvent. toggle() flips the heart and count at once, calls
// the API, and on failure puts back the exact snapshot taken in onMutate. On
// success the server's state replaces the optimistic guess. toggle() does nothing
// until the event has loaded, since there is no state to flip yet.
export function useLikeEvent(eventId: string) {
  const qc = useQueryClient();
  const key = KEYS.event(eventId);
  const event = useEvent(eventId);
  const state: ToggleState = event.data ? { liked: event.data.liked, count: event.data.like_count } : NOT_LOADED;

  const mutation = useMutation({
    mutationFn: (next: boolean) => (next ? api.likeEvent(eventId) : api.unlikeEvent(eventId)),
    onMutate: async (next: boolean) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<EventDetail>(key);
      if (snapshot) {
        const t = applyLikeToggle({ liked: snapshot.liked, count: snapshot.like_count }, next);
        qc.setQueryData<EventDetail>(key, { ...snapshot, liked: t.liked, like_count: t.count });
      }
      return { snapshot };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.snapshot) qc.setQueryData<EventDetail>(key, ctx.snapshot);
    },
    onSuccess: (server) => {
      qc.setQueryData<EventDetail>(key, (old) => (old ? { ...old, liked: server.liked, like_count: server.like_count } : old));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const toggle = () => {
    if (!event.data || mutation.isPending) return;
    mutation.mutate(!state.liked);
  };
  return { state, toggle, isPending: mutation.isPending, error: mutation.error };
}

// Same shape as useLikeEvent for the organiser follow button: state.liked means
// "following" and state.count is the follower count (the shape applyFollowToggle
// works on). Follow state lives on the organiser profile, so this shares the
// useOrganiser cache entry. Settling also refreshes the following feed, whose
// contents depend on who the caller follows.
export function useFollowOrganiser(organiserId: string) {
  const qc = useQueryClient();
  const key = KEYS.organiserProfile(organiserId);
  const profile = useOrganiser(organiserId);
  const state: ToggleState = profile.data ? { liked: profile.data.following, count: profile.data.follower_count } : NOT_LOADED;

  const mutation = useMutation({
    mutationFn: (next: boolean) => (next ? api.followOrganiser(organiserId) : api.unfollowOrganiser(organiserId)),
    onMutate: async (next: boolean) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<OrganiserProfile>(key);
      if (snapshot) {
        const t = applyFollowToggle({ liked: snapshot.following, count: snapshot.follower_count }, next);
        qc.setQueryData<OrganiserProfile>(key, { ...snapshot, following: t.liked, follower_count: t.count });
      }
      return { snapshot };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.snapshot) qc.setQueryData<OrganiserProfile>(key, ctx.snapshot);
    },
    onSuccess: (server) => {
      qc.setQueryData<OrganiserProfile>(key, (old) => (old ? { ...old, following: server.following, follower_count: server.follower_count } : old));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: KEYS.followingAll });
    },
  });

  const toggle = () => {
    if (!profile.data || mutation.isPending) return;
    mutation.mutate(!state.liked);
  };
  return { state, toggle, isPending: mutation.isPending, error: mutation.error };
}
