// ── Paymax Mobility — Multi-mode data hooks ──────────────────────────────────
// React Query hooks for parcel · bus · towing · movers · car-hire, mirroring
// useMobility.ts so screens stay declarative and share caching / loading /
// error contracts. Money mutations attach Idempotency-Keys via the api layer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as parcel from '../api/parcel.api';
import * as bus from '../api/bus.api';
import * as towing from '../api/towing.api';
import * as movers from '../api/movers.api';
import * as carhire from '../api/carhire.api';
import {
  PARCEL_KEY,
  BUS_KEY,
  TOWING_KEY,
  MOVERS_KEY,
  CARHIRE_KEY,
} from '../constants/modes.constants';
import { newIdempotencyKey, toMobilityError } from '../utils/mobilityFormatters';
import type {
  ParcelEstimateRequest,
  ParcelBookRequest,
  TowingEstimateRequest,
  TowingBookRequest,
  MoverQuoteRequest,
  CarHireQuoteRequest,
  CarHireBookRequest,
} from '../types/modes.types';

// ═══════════════════════════════════════════════════════════════════════════════
// PARCEL
// ═══════════════════════════════════════════════════════════════════════════════
export function useParcelEstimate() {
  return useMutation({
    mutationFn: (req: ParcelEstimateRequest) => parcel.estimateParcel(req),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useBookParcel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<ParcelBookRequest, 'idempotencyKey'>) =>
      parcel.bookParcel({ ...req, idempotencyKey: newIdempotencyKey('parcel') }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PARCEL_KEY, 'list'] }),
  });
}

export function useParcel(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [PARCEL_KEY, 'detail', id],
    queryFn: () => parcel.getParcel(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useParcels() {
  return useQuery({ queryKey: [PARCEL_KEY, 'list'], queryFn: parcel.getParcels, staleTime: 20_000 });
}

export function useCancelParcel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => parcel.cancelParcel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PARCEL_KEY] }),
  });
}

export function useRateParcel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stars, comment, tipKobo }: { id: string; stars: number; comment?: string; tipKobo?: number }) =>
      parcel.rateParcel(id, stars, newIdempotencyKey('parcel-rate'), comment, tipKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PARCEL_KEY] }),
  });
}

export function useCourierRequests(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [PARCEL_KEY, 'courier', 'requests'],
    queryFn: parcel.getCourierRequests,
    refetchInterval: options?.poll ? 5_000 : false,
    staleTime: 3_000,
  });
}

export function useCourierActions() {
  const accept = useMutation({ mutationFn: (id: string) => parcel.acceptCourierRequest(id, newIdempotencyKey('cou-accept')) });
  const verifyPickup = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => parcel.courierVerifyPickupPin(id, pin),
    onError: (e) => { throw toMobilityError(e); },
  });
  const pickedUp = useMutation({ mutationFn: ({ id, photoUrl }: { id: string; photoUrl: string }) => parcel.courierPickedUp(id, photoUrl) });
  const verifyDropoff = useMutation({
    mutationFn: ({ id, pin, proofUrl }: { id: string; pin: string; proofUrl: string }) => parcel.courierVerifyDropoff(id, pin, proofUrl),
    onError: (e) => { throw toMobilityError(e); },
  });
  return { accept, verifyPickup, pickedUp, verifyDropoff };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUS
// ═══════════════════════════════════════════════════════════════════════════════
export function useBusRoutes(origin: string, dest: string, enabled: boolean) {
  return useQuery({
    queryKey: [BUS_KEY, 'routes', origin, dest],
    queryFn: () => bus.searchRoutes(origin, dest),
    enabled,
    staleTime: 30_000,
  });
}

export function useBusSchedules(routeId?: string, date?: string) {
  return useQuery({
    queryKey: [BUS_KEY, 'schedules', routeId, date],
    queryFn: () => bus.getSchedules(routeId as string, date as string),
    enabled: Boolean(routeId),
    staleTime: 20_000,
  });
}

export function useBusSeatMap(scheduleId?: string) {
  return useQuery({
    queryKey: [BUS_KEY, 'seats', scheduleId],
    queryFn: () => bus.getSeatMap(scheduleId as string),
    enabled: Boolean(scheduleId),
    staleTime: 5_000,
  });
}

export function useBookBus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Parameters<typeof bus.bookBus>[0]) => bus.bookBus(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, 'tickets'] }),
  });
}

export function useBusTickets() {
  return useQuery({ queryKey: [BUS_KEY, 'tickets'], queryFn: bus.getTickets, staleTime: 20_000 });
}

export function useBusTicket(id?: string) {
  return useQuery({
    queryKey: [BUS_KEY, 'ticket', id],
    queryFn: () => bus.getTicket(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCancelTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bus.cancelTicket(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY] }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOWING
// ═══════════════════════════════════════════════════════════════════════════════
export function useTowingEstimate() {
  return useMutation({
    mutationFn: (req: TowingEstimateRequest) => towing.estimateTowing(req),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useBookTowing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<TowingBookRequest, 'idempotencyKey'>) =>
      towing.bookTowing({ ...req, idempotencyKey: newIdempotencyKey('towing') }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [TOWING_KEY] }),
  });
}

export function useTowingJob(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [TOWING_KEY, 'detail', id],
    queryFn: () => towing.getTowingJob(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useCancelTowing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => towing.cancelTowing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [TOWING_KEY] }),
  });
}

export function useRateTowing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stars, comment, tipKobo }: { id: string; stars: number; comment?: string; tipKobo?: number }) =>
      towing.rateTowing(id, stars, newIdempotencyKey('towing-rate'), comment, tipKobo),
    onSuccess: () => qc.invalidateQueries({ queryKey: [TOWING_KEY] }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVERS
// ═══════════════════════════════════════════════════════════════════════════════
export function useRequestQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: MoverQuoteRequest) => movers.requestQuote(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MOVERS_KEY, 'list'] }),
  });
}

export function useMoverJob(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [MOVERS_KEY, 'detail', id],
    queryFn: () => movers.getMoverJob(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useMoverJobs() {
  return useQuery({ queryKey: [MOVERS_KEY, 'list'], queryFn: movers.getMoverJobs, staleTime: 20_000 });
}

export function useMoverActions() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: [MOVERS_KEY, 'list'] });
    if (id) qc.invalidateQueries({ queryKey: [MOVERS_KEY, 'detail', id] });
  };
  const acceptBid = useMutation({
    mutationFn: ({ id, bidId }: { id: string; bidId: string }) => movers.acceptBid(id, bidId, newIdempotencyKey('mov-accept')),
    onSuccess: (_d, v) => invalidate(v.id),
  });
  const confirmCompletion = useMutation({
    mutationFn: (id: string) => movers.confirmCompletion(id, newIdempotencyKey('mov-complete')),
    onSuccess: (_d, id) => invalidate(id),
  });
  const rate = useMutation({
    mutationFn: ({ id, stars, comment, tipKobo }: { id: string; stars: number; comment?: string; tipKobo?: number }) =>
      movers.rateMover(id, stars, newIdempotencyKey('mover-rate'), comment, tipKobo),
    onSuccess: (_d, v) => invalidate(v.id),
  });
  return { acceptBid, confirmCompletion, rate };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAR HIRE
// ═══════════════════════════════════════════════════════════════════════════════
export function useCarHireQuote() {
  return useMutation({
    mutationFn: (req: CarHireQuoteRequest) => carhire.quoteCarHire(req),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useBookCarHire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<CarHireBookRequest, 'idempotencyKey'>) =>
      carhire.bookCarHire({ ...req, idempotencyKey: newIdempotencyKey('carhire') }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [CARHIRE_KEY, 'list'] }),
  });
}

export function useCarHire(id?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [CARHIRE_KEY, 'detail', id],
    queryFn: () => carhire.getCarHire(id as string),
    enabled: Boolean(id),
    refetchInterval: options?.poll ? 5_000 : false,
    staleTime: 2_000,
  });
}

export function useCarHireBookings() {
  return useQuery({ queryKey: [CARHIRE_KEY, 'list'], queryFn: carhire.getCarHireBookings, staleTime: 20_000 });
}

export function useCarHireActions() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: [CARHIRE_KEY, 'list'] });
    if (id) qc.invalidateQueries({ queryKey: [CARHIRE_KEY, 'detail', id] });
  };
  const extend = useMutation({
    mutationFn: ({ id, extraHours }: { id: string; extraHours: number }) =>
      carhire.extendCarHire(id, { extraHours, idempotencyKey: newIdempotencyKey('carhire-ext') }),
    onSuccess: (_d, v) => invalidate(v.id),
  });
  const complete = useMutation({
    mutationFn: (id: string) => carhire.completeCarHire(id, newIdempotencyKey('carhire-done')),
    onSuccess: (_d, id) => invalidate(id),
  });
  return { extend, complete };
}
