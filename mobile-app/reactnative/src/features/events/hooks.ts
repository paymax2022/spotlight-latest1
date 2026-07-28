import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { CreateEventInput, PurchaseTicketInput, GiftTicketInput, TopUpSource } from './types';

const KEYS = {
  events:    (params?: { category?: string; state?: string }) => ['events', 'list', params ?? {}] as const,
  event:     (id: string) => ['events', 'event', id] as const,
  tickets:   ['events', 'tickets'] as const,
  ticket:    (id: string) => ['events', 'ticket', id] as const,
  wallet:    (walletId: string) => ['events', 'wallet', walletId] as const,
  walletEntries: (walletId: string) => ['events', 'wallet', walletId, 'entries'] as const,
  vendors:   (id: string) => ['events', 'vendors', id] as const,
  venue:     (id: string) => ['events', 'venue', id] as const,
  organiser: ['events', 'organiser'] as const,
  attendees: (id: string) => ['events', 'attendees', id] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
export const useEvents = (params?: { category?: string; state?: string }) =>
  useQuery({ queryKey: KEYS.events(params), queryFn: () => api.listEvents(params) });

export const useEvent = (id: string) =>
  useQuery({ queryKey: KEYS.event(id), queryFn: () => api.getEvent(id), enabled: !!id });

export const useMyTickets = () =>
  useQuery({ queryKey: KEYS.tickets, queryFn: api.listMyTickets });

export const useTicket = (id: string) =>
  useQuery({ queryKey: KEYS.ticket(id), queryFn: () => api.getTicket(id), enabled: !!id });

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

export const useOrganiserEvents = () =>
  useQuery({ queryKey: KEYS.organiser, queryFn: api.listOrganiserEvents });

export const useAttendees = (eventId: string) =>
  useQuery({ queryKey: KEYS.attendees(eventId), queryFn: () => api.listAttendees(eventId), enabled: !!eventId });

// ── Mutations ────────────────────────────────────────────────────────────────
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
    mutationFn: (credentialId: string) => api.validateScan(credentialId),
  });
}
