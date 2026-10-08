// Paymax Connect — Unified Profile React Query hooks (PRD §10.4 PR-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as profileApi from './api';
import type { ConnectMode, EditProfileInput, PrivacySettings } from './types';

export const profileKeys = {
  all: ['connect', 'profile'] as const,
  unified: () => [...profileKeys.all, 'unified'] as const,
  privacy: () => [...profileKeys.all, 'privacy'] as const,
  photos: () => [...profileKeys.all, 'photos'] as const,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
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

export function usePhotos() {
  return useQuery({
    queryKey: profileKeys.photos(),
    queryFn: profileApi.getPhotos,
  });
}

function usePhotoMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.photos() });
      qc.invalidateQueries({ queryKey: profileKeys.unified() });
    },
  });
}

export function useAddPhoto() {
  return usePhotoMutation((v: { uri: string; mime?: string | null }) =>
    profileApi.addPhoto(v.uri, v.mime),
  );
}

export function useReorderPhotos() {
  return usePhotoMutation((ids: string[]) => profileApi.reorderPhotos(ids));
}

export function useRemovePhoto() {
  return usePhotoMutation((id: string) => profileApi.removePhoto(id));
}

export function useBadges() {
  return useQuery({
    queryKey: profileKeys.badges(),
    queryFn: profileApi.getBadges,
  });
}
