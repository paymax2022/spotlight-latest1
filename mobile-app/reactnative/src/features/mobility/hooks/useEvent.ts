// ── Event Transport — data hooks ─────────────────────────────────────────────
// React Query hooks for the event-transport mode, mirroring useModes.ts so
// screens stay declarative and share caching / loading / error contracts. Money
// mutations attach Idempotency-Keys via newIdempotencyKey.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as event from '../api/event.api';
import { EVENT_KEY } from '../constants/modes.constants';
import { newIdempotencyKey, toMobilityError } from '../utils/mobilityFormatters';
import type { OfferCreateRequest, BookRequest } from '../types/event.types';

// ─── Offers ───────────────────────────────────────────────────────────────────
export function useEventOffers(eventId?: string) {
  return useQuery({
    queryKey: [EVENT_KEY, 'offers', eventId],
    queryFn: () => event.getEventOffers(eventId as string),
    enabled: Boolean(eventId),
    staleTime: 15_000,
  });
}

export function useOffer(id?: string) {
  return useQuery({
    queryKey: [EVENT_KEY, 'offer', id],
    queryFn: () => event.getOffer(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<OfferCreateRequest, 'idempotencyKey'>) =>
      event.createOffer({ ...req, idempotencyKey: newIdempotencyKey('event-offer') }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [EVENT_KEY, 'offers'] }),
  });
}

// ─── Booking (money mutation) ──────────────────────────────────────────────────
export function useBookOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<BookRequest, 'idempotencyKey'>) =>
      event.bookOffer({ ...req, idempotencyKey: newIdempotencyKey('event-book') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [EVENT_KEY, 'bookings'] });
      qc.invalidateQueries({ queryKey: [EVENT_KEY, 'offers'] });
    },
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useBookings() {
  return useQuery({ queryKey: [EVENT_KEY, 'bookings'], queryFn: event.getBookings, staleTime: 20_000 });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => event.cancelBooking(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [EVENT_KEY] }),
  });
}
