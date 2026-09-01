// ── Stays hotelier — data hooks ──────────────────────────────────────────────
// React Query hooks over the hotelier api. Mutations invalidate the affected
// query so the screen re-renders with server truth after each change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as hotelier from './api';
import type { CreatePropertyInput, CreateRoomTypeInput, CreateRatePlanInput } from './types';

const KEY = 'stays-hotelier';

export function useMyProperties() {
  return useQuery({ queryKey: [KEY, 'mine'], queryFn: hotelier.myProperties, staleTime: 15_000 });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePropertyInput) => hotelier.createProperty(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function usePropertyDetail(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'detail', propertyId],
    queryFn: () => hotelier.getProperty(propertyId as string),
    enabled: Boolean(propertyId),
    staleTime: 10_000,
  });
}

export function useRoomTypes(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'room-types', propertyId],
    queryFn: () => hotelier.listRoomTypes(propertyId as string),
    enabled: Boolean(propertyId),
  });
}

export function useCreateRoomType(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomTypeInput) => hotelier.createRoomType(propertyId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'room-types', propertyId] }),
  });
}

export function useRatePlans(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'rate-plans', propertyId],
    queryFn: () => hotelier.listRatePlans(propertyId as string),
    enabled: Boolean(propertyId),
  });
}

export function useCreateRatePlan(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRatePlanInput) => hotelier.createRatePlan(propertyId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'rate-plans', propertyId] }),
  });
}

export function useHotelierReservations(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'reservations', propertyId],
    queryFn: () => hotelier.listReservations(propertyId as string),
    enabled: Boolean(propertyId),
    staleTime: 10_000,
  });
}
