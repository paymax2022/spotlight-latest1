// Paymax Connect — Networking PROFILE React Query hooks (PRD §6.3 PR-*, §6.5 RC-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as profileApi from './api';
import type { ExperienceInput, EducationInput, AboutInput } from './types';

export const profileKeys = {
  all: ['connect', 'networking', 'profile'] as const,
  experience: () => [...profileKeys.all, 'experience'] as const,
  education: () => [...profileKeys.all, 'education'] as const,
  about: () => [...profileKeys.all, 'about'] as const,
  strength: () => [...profileKeys.all, 'strength'] as const,
  recommendationInbox: () => [...profileKeys.all, 'recommendations', 'inbox'] as const,
  userRecommendations: (userId: string) =>
    [...profileKeys.all, 'recommendations', 'user', userId] as const,
};

// ── Experience (PR-07) ───────────────────────────────────────────────────────
export function useExperience() {
  return useQuery({ queryKey: profileKeys.experience(), queryFn: () => profileApi.getExperience() });
}

export function useAddExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExperienceInput) => profileApi.addExperience(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.experience() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

export function useUpdateExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: ExperienceInput }) => profileApi.updateExperience(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.experience() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

export function useDeleteExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.deleteExperience(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.experience() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

// ── Education (PR-08) ────────────────────────────────────────────────────────
export function useEducation() {
  return useQuery({ queryKey: profileKeys.education(), queryFn: () => profileApi.getEducation() });
}

export function useAddEducation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EducationInput) => profileApi.addEducation(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.education() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

export function useUpdateEducation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: EducationInput }) => profileApi.updateEducation(v.id, v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.education() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

export function useDeleteEducation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.deleteEducation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.education() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

// ── About (PR-09) ────────────────────────────────────────────────────────────
export function useAbout() {
  return useQuery({ queryKey: profileKeys.about(), queryFn: () => profileApi.getAbout() });
}

export function useUpdateAbout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AboutInput) => profileApi.updateAbout(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.about() });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

// ── Strength (PR-11) — band + missing only (PN-1) ────────────────────────────
export function useStrength() {
  return useQuery({ queryKey: profileKeys.strength(), queryFn: () => profileApi.getStrength() });
}

// ── Recommendations (RC-02 / RC-03) ──────────────────────────────────────────
export function useRecommendationInbox() {
  return useQuery({
    queryKey: profileKeys.recommendationInbox(),
    queryFn: () => profileApi.getRecommendationInbox(),
  });
}

export function useAcceptRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.acceptRecommendation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.recommendationInbox() });
      qc.invalidateQueries({ queryKey: [...profileKeys.all, 'recommendations'] });
      qc.invalidateQueries({ queryKey: profileKeys.strength() });
    },
  });
}

export function useDeclineRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.declineRecommendation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.recommendationInbox() }),
  });
}

export function useUserRecommendations(userId: string) {
  return useQuery({
    queryKey: profileKeys.userRecommendations(userId),
    queryFn: () => profileApi.getUserRecommendations(userId),
    enabled: !!userId,
  });
}
