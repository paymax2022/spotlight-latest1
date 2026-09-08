// ── Stays hotelier — data hooks ──────────────────────────────────────────────
// React Query hooks over the hotelier api. Mutations invalidate the affected
// query so the screen re-renders with server truth after each change.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as hotelier from './api';
import type {
  CreatePropertyInput, CreateRoomTypeInput, CreateRatePlanInput,
  UpdatePropertyContentInput, UpdatePropertyDetailsInput,
} from './types';

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

export function useUpdatePropertyContent(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePropertyContentInput) => hotelier.updatePropertyContent(propertyId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', propertyId] }),
  });
}

export function useUpdatePropertyDetails(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePropertyDetailsInput) => hotelier.updatePropertyDetails(propertyId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'detail', propertyId] }),
  });
}

// ── Photos ─────────────────────────────────────────────────────────────────
export function usePropertyPhotos(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'photos', propertyId],
    queryFn: () => hotelier.listPhotos(propertyId as string),
    enabled: Boolean(propertyId),
  });
}

export function useUploadPhoto(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { uri: string; mimeType: string; roomTypeId?: string; caption?: string }) =>
      hotelier.uploadPropertyPhoto(propertyId, { uri: vars.uri, mimeType: vars.mimeType }, { roomTypeId: vars.roomTypeId, caption: vars.caption }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'photos', propertyId] }),
  });
}

export function useSetCoverPhoto(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => hotelier.setCoverPhoto(propertyId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'photos', propertyId] }),
  });
}

export function useDeletePhoto(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => hotelier.deletePhoto(propertyId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'photos', propertyId] }),
  });
}

export function useUpdatePhotoCaption(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { photoId: string; caption: string }) => hotelier.updatePhotoCaption(propertyId, vars.photoId, vars.caption),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'photos', propertyId] }),
  });
}

// ── Go-live verification ──────────────────────────────────────────────────
export function useVerificationStatus(propertyId?: string) {
  return useQuery({
    queryKey: [KEY, 'verification', propertyId],
    queryFn: () => hotelier.getVerificationStatus(propertyId as string),
    enabled: Boolean(propertyId),
    staleTime: 5_000,
  });
}

export function useSubmitForReview(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => hotelier.submitForReview(),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'verification', propertyId] }),
  });
}
