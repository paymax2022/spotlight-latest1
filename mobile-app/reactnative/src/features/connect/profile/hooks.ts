// Paymax Connect — Unified Profile React Query hooks (PRD §10.4 PR-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as profileApi from './api';
import type { ConnectMode, EditProfileInput, PrivacySettings } from './types';

export const profileKeys = {
  all: ['connect', 'profile'] as const,
  unified: () => [...profileKeys.all, 'unified'] as const,
  privacy: () => [...profileKeys.all, 'privacy'] as const,
  photos: (mode: ConnectMode) => [...profileKeys.all, 'photos', mode] as const,
  badges: () => [...profileKeys.all, 'badges'] as const,
};

export function useUnifiedProfile() {
  return useQuery({
    queryKey: profileKeys.unified(),
    queryFn: profileApi.getUnifiedProfile,
  });
}

export function useUpdateModeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EditProfileInput) => profileApi.updateModeProfile(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
      qc.invalidateQueries({ queryKey: profileKeys.photos(input.mode) });
    },
  });
}

export function useSetModeVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mode: ConnectMode; visible: boolean }) =>
      profileApi.setModeVisibility(v.mode, v.visible),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
      qc.invalidateQueries({ queryKey: profileKeys.privacy() });
    },
  });
}

export function usePrivacy() {
  return useQuery({
    queryKey: profileKeys.privacy(),
    queryFn: profileApi.getPrivacy,
  });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: PrivacySettings) => profileApi.updatePrivacy(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.privacy() });
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
    },
  });
}

export function usePhotos(mode: ConnectMode) {
  return useQuery({
    queryKey: profileKeys.photos(mode),
    queryFn: () => profileApi.getPhotos(mode),
  });
}

export function useReorderPhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mode: ConnectMode; photos: string[] }) =>
      profileApi.reorderPhotos(v.mode, v.photos),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: profileKeys.photos(v.mode) });
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
    },
  });
}

export function useRemovePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mode: ConnectMode; uri: string }) =>
      profileApi.removePhoto(v.mode, v.uri),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: profileKeys.photos(v.mode) });
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
    },
  });
}

export function useBadges() {
  return useQuery({
    queryKey: profileKeys.badges(),
    queryFn: profileApi.getBadges,
  });
}
