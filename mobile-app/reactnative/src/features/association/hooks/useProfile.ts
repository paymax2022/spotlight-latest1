// ── Association — Member profile hooks (C) ────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyProfile, updateMyProfile, getPrivacy, updatePrivacy, getActivity,
} from '../api/profile.api';
import type { ProfileEdit, PrivacySettings } from '../types/profile.types';

const KEY = 'association';

export function useMyProfile() {
  return useQuery({ queryKey: [KEY, 'myProfile'], queryFn: getMyProfile, staleTime: 30_000 });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edit: ProfileEdit) => updateMyProfile(edit),
    onSuccess: (data) => {
      qc.setQueryData([KEY, 'myProfile'], data);
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
    },
  });
}

export function usePrivacy() {
  return useQuery({ queryKey: [KEY, 'privacy'], queryFn: getPrivacy, staleTime: 30_000 });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: PrivacySettings) => updatePrivacy(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'privacy'], data),
  });
}

export function useActivity() {
  return useQuery({ queryKey: [KEY, 'activity'], queryFn: getActivity, staleTime: 30_000 });
}
