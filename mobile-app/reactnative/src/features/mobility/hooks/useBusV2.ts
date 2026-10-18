// React Query hooks for the PRD v2 bus customer flow — mirrors useModes /
// useBusMarketplace conventions. Money mutations (holds are inventory — also
// idempotent) carry Idempotency-Keys via the api layer; the caller supplies
// one key per attempt so retries replay instead of duplicating.

import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as v2 from '../api/busv2.api';
import { BUS_KEY } from '../constants/modes.constants';
import { newIdempotencyKey, toMobilityError } from '../utils/mobilityFormatters';
import {
  getBusDraft,
  subscribeBusDraft,
  type BusCheckoutDraft,
} from '../utils/busCheckoutDraft';
import type {
  BusBookLegInput,
  BusBookPassengerInput,
  BusHoldInput,
  BusV2SearchParams,
} from '../types/busV2.types';

const V2 = 'busv2';

/** The shared checkout draft — updates when any step mutates it. */
export function useBusDraft(): BusCheckoutDraft | null {
  return useSyncExternalStore(subscribeBusDraft, getBusDraft, getBusDraft);
}

// GEOGRAPHY — reference data; long stale time, it changes rarely.
export function useBusGeoStates() {
  return useQuery({
    queryKey: [BUS_KEY, V2, 'geo-states'],
    queryFn: v2.listGeoStates,
    staleTime: 5 * 60_000,
  });
}

export function useBusGeoCities(stateId?: string) {
  return useQuery({
    queryKey: [BUS_KEY, V2, 'geo-cities', stateId ?? ''],
    queryFn: () => v2.listGeoCities(stateId as string),
    enabled: Boolean(stateId),
    staleTime: 5 * 60_000,
  });
}

// SEARCH
export function useBusDepartureSearch(params: BusV2SearchParams | null) {
  return useQuery({
    queryKey: [
      BUS_KEY,
      V2,
      'search',
      params?.fromStateId ?? '',
      params?.toStateId ?? '',
      params?.fromCityId ?? '',
      params?.toCityId ?? '',
      params?.date ?? '',
      params?.pax ?? 1,
      params?.tripType ?? 'oneway',
      params?.returnDate ?? '',
    ],
    queryFn: () => v2.searchDepartures(params as BusV2SearchParams),
    enabled: Boolean(params?.fromStateId && params?.toStateId && params?.date),
    staleTime: 30_000,
  });
}

// DEPARTURE DETAIL (stops + layout + occupancy + OD fares). Short staleTime —
// occupancy moves as other customers hold/book.
export function useBusDeparture(departureId?: string) {
  return useQuery({
    queryKey: [BUS_KEY, V2, 'departure', departureId],
    queryFn: () => v2.getDeparture(departureId as string),
    enabled: Boolean(departureId),
    staleTime: 5_000,
  });
}

// HOLDS
export function useCreateBusHold() {
  return useMutation({
    // idempotencyKey is supplied by the caller — one key per hold attempt so a
    // retried submit replays the same hold rather than minting a second.
    mutationFn: (req: BusHoldInput & { idempotencyKey: string }) =>
      v2.createHold(req, req.idempotencyKey),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useReleaseBusHold() {
  return useMutation({
    mutationFn: (holdId: string) => v2.releaseHold(holdId),
    onError: (e) => { throw toMobilityError(e); },
  });
}

// BOOKING — creates the pending-payment booking + server quote.
export function useCreateBusBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      holdId: string;
      legs: BusBookLegInput[];
      passengers: BusBookPassengerInput[];
      idempotencyKey: string;
    }) => v2.createBooking(req, req.idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, V2, 'bookings'] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

// PAYSTACK INITIATE — server-initiated transaction resumed by useGatewayCheckout.
export function initiateBusPaystack(bookingRef: string, email?: string) {
  return v2.initiatePaystack(bookingRef, newIdempotencyKey('bus-pay'), email);
}

// TICKETS
export function useBusV2Bookings() {
  return useQuery({
    queryKey: [BUS_KEY, V2, 'bookings'],
    queryFn: v2.listMyBookings,
    staleTime: 20_000,
  });
}

export function useBusV2Booking(bookingRef?: string) {
  return useQuery({
    queryKey: [BUS_KEY, V2, 'booking', bookingRef],
    queryFn: () => v2.getBooking(bookingRef as string),
    enabled: Boolean(bookingRef),
    staleTime: 5_000,
    // Poll while the webhook is still turning a paid booking into tickets.
    refetchInterval: (q) =>
      q.state.data?.status === 'pending_payment' || q.state.data?.status === 'partially_issued'
        ? 3_000
        : false,
  });
}

export function useBusCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingRef: string) =>
      v2.requestCancellation(bookingRef, newIdempotencyKey('bus-cancel')),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, V2] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}
