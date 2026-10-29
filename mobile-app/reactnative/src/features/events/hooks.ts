import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { applyLikeToggle, applyFollowToggle, type ToggleState } from './social';
import type { EventDetail, EventQuery, OrganiserProfile, EventPatch, TierPatch, PromoPatch, CreatePromoInput, IssueCompInput, AnnounceInput, AddTierInput, CreateEventInput, PurchaseTicketInput, GiftTicketInput, TopUpSource, GateToken, Gate, AddTeamMemberInput, OpenCaseInput, QuoteArgs, RosterFilter } from './types';
import { EVENTS_COMMERCE_ENABLED } from './constants/events.constants';

// Exported so useEventsRealtime (realtime/useEventsRealtime.ts) can invalidate
// the exact same query keys on a push, rather than duplicating the shape.
export const KEYS = {
  events:    (params?: EventQuery) => ['events', 'list', params ?? {}] as const,
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
  // Commerce (FEATURE_EVENTS_COMMERCIAL). The unread badge is keyed separately
  // from the paged list so marking one read refreshes both.
  quote:        (q: QuoteArgs) => ['events', 'quote', q] as const,
  orders:       ['events', 'orders'] as const,
  bookings:     ['events', 'bookings'] as const,
  booking:      (ref: string) => ['events', 'booking', ref] as const,
  myRefunds:    ['events', 'my-refunds'] as const,
  eventRefunds: (id: string, status: string) => ['events', 'event-refunds', id, status] as const,
  notifications: (unreadOnly: boolean) => ['events', 'notifications', { unreadOnly }] as const,
  unreadCount:  ['events', 'notifications', 'unread'] as const,
  cases:        (status: string) => ['events', 'cases', status] as const,
  caseDetail:   (id: string) => ['events', 'case', id] as const,
  roster:       (id: string, f: RosterFilter) => ['events', 'roster', id, f] as const,
  checkinStats:  (id: string) => ['events', 'checkin-stats', id] as const,
  checkinHistory:(id: string) => ['events', 'checkin-history', id] as const,
  moderation:   (id: string) => ['events', 'moderation', id] as const,
};

export const useEvents = (params?: EventQuery) =>
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
      // A paid checkout changes the receipt list, its booking and the seat
      // counters on the event card.
      qc.invalidateQueries({ queryKey: KEYS.orders });
      qc.invalidateQueries({ queryKey: KEYS.bookings });
      qc.invalidateQueries({ queryKey: ['events', 'notifications'] });
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

// ── Commerce (FEATURE_EVENTS_COMMERCIAL) ─────────────────────────────────────
// Every query below is disabled while the flag is off, because the routes are
// unmounted server-side — an unflagged call is a 404, not a retryable failure.
const COMMERCE = EVENTS_COMMERCE_ENABLED;

export const useQuote = (args: QuoteArgs | null) =>
  useQuery({
    queryKey: KEYS.quote(args ?? { eventId: '', tier_id: '', quantity: 0 }),
    queryFn: () => api.quoteTickets(args as QuoteArgs),
    enabled: COMMERCE && !!args && !!args.eventId && !!args.tier_id && args.quantity > 0,
    // Prices and remaining seats move while a basket is open, but not by the
    // second; this is a freshness floor, not a cache of the amount charged.
    staleTime: 15_000,
  });

export const useMyOrders = () =>
  useQuery({ queryKey: KEYS.orders, queryFn: () => api.listMyOrders(), enabled: COMMERCE });

export const useMyBookings = () =>
  useQuery({ queryKey: KEYS.bookings, queryFn: () => api.listMyBookings(), enabled: COMMERCE });

export const useBooking = (bookingRef: string) =>
  useQuery({ queryKey: KEYS.booking(bookingRef), queryFn: () => api.getBooking(bookingRef), enabled: COMMERCE && !!bookingRef });

export const useMyRefunds = () =>
  useQuery({ queryKey: KEYS.myRefunds, queryFn: api.listMyRefunds, enabled: COMMERCE });

export function useRequestRefund() {
  const qc = useQueryClient();
  return useMutation({
    // One key per user intent: the caller keeps the same idem across a retry so
    // the server replays the request instead of opening a second case.
    mutationFn: ({ ticketId, reason, idemKey }: { ticketId: string; reason: string; idemKey: string }) =>
      api.requestRefund(ticketId, reason, idemKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.myRefunds });
      qc.invalidateQueries({ queryKey: KEYS.tickets });
      qc.invalidateQueries({ queryKey: KEYS.notifications(true) });
    },
  });
}

// ── Organiser: refund queue ──────────────────────────────────────────────────
export const useEventRefunds = (eventId: string, status = '') =>
  useQuery({
    queryKey: KEYS.eventRefunds(eventId, status),
    queryFn: () => api.listEventRefunds(eventId, status),
    enabled: COMMERCE && !!eventId,
  });

function useRefundQueue(eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEYS.eventRefunds(eventId, '') });
    qc.invalidateQueries({ queryKey: KEYS.eventRefunds(eventId, 'REQUESTED') });
    qc.invalidateQueries({ queryKey: KEYS.myRefunds });
    qc.invalidateQueries({ queryKey: KEYS.tickets });
    qc.invalidateQueries({ queryKey: KEYS.event(eventId) });
  };
}

export function useDecideRefund(eventId: string) {
  const invalidate = useRefundQueue(eventId);
  return useMutation({
    mutationFn: ({ refundId, approve, note }: { refundId: string; approve: boolean; note?: string }) =>
      api.decideEventRefund(eventId, refundId, approve, note ?? ''),
    onSuccess: invalidate,
  });
}

export function useExecuteRefund(eventId: string) {
  const invalidate = useRefundQueue(eventId);
  return useMutation({
    mutationFn: (refundId: string) => api.executeEventRefund(eventId, refundId),
    onSuccess: invalidate,
  });
}

// ── Notification inbox ───────────────────────────────────────────────────────
export const useNotifications = (unreadOnly = false) =>
  useQuery({ queryKey: KEYS.notifications(unreadOnly), queryFn: () => api.listNotifications({ unreadOnly }), enabled: COMMERCE });

// The badge only needs the count, so it reads the same cached page list rather
// than issuing a second request per screen.
export function useUnreadCount() {
  const { data } = useNotifications(false);
  return data?.unread ?? 0;
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', 'notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events', 'notifications'] }); },
  });
}

// ── Support desk ─────────────────────────────────────────────────────────────
export const useMyCases = (status = '') =>
  useQuery({ queryKey: KEYS.cases(status), queryFn: () => api.listMyCases(status), enabled: COMMERCE });

export const useSupportCase = (caseId: string) =>
  useQuery({
    queryKey: KEYS.caseDetail(caseId),
    queryFn: () => api.getSupportCase(caseId),
    enabled: COMMERCE && !!caseId,
  });

export function useOpenSupportCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenCaseInput) => api.openSupportCase(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', 'cases'] });
      qc.invalidateQueries({ queryKey: ['events', 'notifications'] });
    },
  });
}

export function useReplySupportCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.replySupportCase(caseId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.caseDetail(caseId) });
      qc.invalidateQueries({ queryKey: ['events', 'cases'] });
    },
  });
}

// ── Door operations ──────────────────────────────────────────────────────────
// The door works from this list while people are physically queueing, so it
// re-reads on the same cadence as the roster poll it replaces.
export const useRoster = (eventId: string, f: RosterFilter = {}) =>
  useQuery({
    queryKey: KEYS.roster(eventId, f),
    queryFn: () => api.listRoster(eventId, f),
    enabled: COMMERCE && !!eventId,
    refetchInterval: COMMERCE ? 15_000 : 0,
  });

export const useCheckinStats = (eventId: string) =>
  useQuery({
    queryKey: KEYS.checkinStats(eventId),
    queryFn: () => api.getCheckinStats(eventId),
    enabled: COMMERCE && !!eventId,
    refetchInterval: COMMERCE ? 15_000 : 0,
  });

export const useCheckinHistory = (eventId: string) =>
  useQuery({ queryKey: KEYS.checkinHistory(eventId), queryFn: () => api.listCheckinHistory(eventId), enabled: COMMERCE && !!eventId });

function useDoorInvalidators(eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['events', 'roster', eventId] });
    qc.invalidateQueries({ queryKey: KEYS.checkinStats(eventId) });
    qc.invalidateQueries({ queryKey: KEYS.checkinHistory(eventId) });
    qc.invalidateQueries({ queryKey: KEYS.attendees(eventId) });
    qc.invalidateQueries({ queryKey: KEYS.event(eventId) });
  };
}

export function useManualCheckIn(eventId: string) {
  const invalidate = useDoorInvalidators(eventId);
  return useMutation({
    mutationFn: (input: { ticket_id: string; gate?: string; reason?: string }) => api.manualCheckIn(eventId, input),
    onSuccess: invalidate,
  });
}

export function useUndoCheckIn(eventId: string) {
  const invalidate = useDoorInvalidators(eventId);
  return useMutation({
    mutationFn: (input: { ticket_id: string; reason: string }) => api.undoCheckIn(eventId, input),
    onSuccess: invalidate,
  });
}

// ── Governance ───────────────────────────────────────────────────────────────
export function useSubmitForReview(eventId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateOrganiserEvent();
  return useMutation({
    mutationFn: () => api.submitEventForReview(eventId),
    onSuccess: () => {
      invalidate(eventId);
      qc.invalidateQueries({ queryKey: KEYS.moderation(eventId) });
    },
  });
}

export const useEventModeration = (eventId: string) =>
  useQuery({ queryKey: KEYS.moderation(eventId), queryFn: () => api.listEventModeration(eventId), enabled: COMMERCE && !!eventId });
