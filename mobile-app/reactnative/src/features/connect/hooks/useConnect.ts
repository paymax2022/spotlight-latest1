import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as connectApi from '../api/connect.api';
import { getConnectConfig } from '../api/connect.api';
import type {
  DataSaverPrefs,
  NotificationPrefs,
  PrivacyPrefs,
} from '../types/connect.types';

export const connectKeys = {
  all: ['connect'] as const,
  config: () => [...connectKeys.all, 'config'] as const,
  tierStatus: () => [...connectKeys.all, 'tier-status'] as const,
  tierBenefits: () => [...connectKeys.all, 'tier-benefits'] as const,
  wallet: () => [...connectKeys.all, 'wallet'] as const,
  me: () => [...connectKeys.all, 'me'] as const,
  onboardingDraft: () => [...connectKeys.all, 'onboarding', 'draft'] as const,
  notifications: () => [...connectKeys.all, 'notifications'] as const,
  privacy: () => [...connectKeys.all, 'privacy'] as const,
  blocked: () => [...connectKeys.all, 'blocked'] as const,
  reportReasons: () => [...connectKeys.all, 'report-reasons'] as const,
  safetyCases: () => [...connectKeys.all, 'safety-cases'] as const,
  dateSafety: () => [...connectKeys.all, 'date-safety'] as const,
  language: () => [...connectKeys.all, 'language'] as const,
  dataSaver: () => [...connectKeys.all, 'data-saver'] as const,
  premiumStatus: () => [...connectKeys.all, 'premium', 'status'] as const,
  premiumPlans: () => [...connectKeys.all, 'premium', 'plans'] as const,
  help: () => [...connectKeys.all, 'help'] as const,
  legal: () => [...connectKeys.all, 'legal'] as const,
};

// useConnectConfig fetches backend-owned config (mock-first in Phase 0).
export function useConnectConfig() {
  return useQuery({
    queryKey: connectKeys.config(),
    queryFn: getConnectConfig,
  });
}

// ── Tier / wallet ────────────────────────────────────────────────────────────

export function useTierStatus() {
  return useQuery({ queryKey: connectKeys.tierStatus(), queryFn: connectApi.getTierStatus });
}

export function useTierBenefits() {
  return useQuery({ queryKey: connectKeys.tierBenefits(), queryFn: connectApi.getTierBenefits });
}

export function useWalletSummary() {
  return useQuery({ queryKey: connectKeys.wallet(), queryFn: connectApi.getWalletSummary });
}

// ── Me hub ───────────────────────────────────────────────────────────────────

export function useMeSummary() {
  return useQuery({ queryKey: connectKeys.me(), queryFn: connectApi.getMeSummary });
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export function useOnboardingDraft() {
  return useQuery({ queryKey: connectKeys.onboardingDraft(), queryFn: connectApi.getOnboardingDraft });
}

export function useSaveOnboardingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.saveOnboardingDraft,
    onSuccess: (draft) => qc.setQueryData(connectKeys.onboardingDraft(), draft),
  });
}

export function useSubmitDob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.submitDob,
    onSuccess: () => qc.invalidateQueries({ queryKey: connectKeys.onboardingDraft() }),
  });
}

export function useSubmitLiveness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.submitLiveness,
    onSuccess: (draft) => qc.setQueryData(connectKeys.onboardingDraft(), draft),
  });
}

export function useLinkIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { identityType: 'bvn' | 'nin'; value: string }) =>
      connectApi.linkIdentity(v.identityType, v.value),
    onSuccess: (draft) => qc.setQueryData(connectKeys.onboardingDraft(), draft),
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.completeOnboarding,
    onSuccess: (draft) => qc.setQueryData(connectKeys.onboardingDraft(), draft),
  });
}

// ── Notifications ────────────────────────────────────────────────────────────

export function useNotificationPrefs() {
  return useQuery({ queryKey: connectKeys.notifications(), queryFn: connectApi.getNotificationPrefs });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => connectApi.updateNotificationPrefs(patch),
    onSuccess: (data) => qc.setQueryData(connectKeys.notifications(), data),
  });
}

// ── Privacy / blocked ────────────────────────────────────────────────────────

export function usePrivacyPrefs() {
  return useQuery({ queryKey: connectKeys.privacy(), queryFn: connectApi.getPrivacyPrefs });
}

export function useUpdatePrivacyPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PrivacyPrefs>) => connectApi.updatePrivacyPrefs(patch),
    onSuccess: (data) => qc.setQueryData(connectKeys.privacy(), data),
  });
}

export function useBlockedUsers() {
  return useQuery({ queryKey: connectKeys.blocked(), queryFn: connectApi.getBlockedUsers });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.unblockUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: connectKeys.blocked() }),
  });
}

// ── Safety: reports / appeals / cases ─────────────────────────────────────────

export function useReportReasons() {
  return useQuery({ queryKey: connectKeys.reportReasons(), queryFn: connectApi.getReportReasons });
}

export function useSafetyCases() {
  return useQuery({ queryKey: connectKeys.safetyCases(), queryFn: connectApi.getSafetyCases });
}

export function useSubmitReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.submitReport,
    onSuccess: () => qc.invalidateQueries({ queryKey: connectKeys.safetyCases() }),
  });
}

export function useSubmitAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.submitAppeal,
    onSuccess: () => qc.invalidateQueries({ queryKey: connectKeys.safetyCases() }),
  });
}

// ── Date safety / SOS ─────────────────────────────────────────────────────────

export function useDateSafetyState() {
  return useQuery({ queryKey: connectKeys.dateSafety(), queryFn: connectApi.getDateSafetyState });
}

export function useUpdateDateSafetyState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.updateDateSafetyState,
    onSuccess: (data) => qc.setQueryData(connectKeys.dateSafety(), data),
  });
}

export function useAddSosContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.addSosContact,
    onSuccess: (data) => qc.setQueryData(connectKeys.dateSafety(), data),
  });
}

// ── Language / data-saver / premium / help / legal ────────────────────────────

export function useLanguage() {
  return useQuery({ queryKey: connectKeys.language(), queryFn: connectApi.getLanguage });
}

export function useSetLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectApi.setLanguage,
    onSuccess: (code) => qc.setQueryData(connectKeys.language(), code),
  });
}

export function useDataSaverPrefs() {
  return useQuery({ queryKey: connectKeys.dataSaver(), queryFn: connectApi.getDataSaverPrefs });
}

export function useUpdateDataSaverPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DataSaverPrefs>) => connectApi.updateDataSaverPrefs(patch),
    onSuccess: (data) => qc.setQueryData(connectKeys.dataSaver(), data),
  });
}

export function usePremiumStatus() {
  return useQuery({ queryKey: connectKeys.premiumStatus(), queryFn: connectApi.getPremiumStatus });
}

export function usePremiumPlans() {
  return useQuery({ queryKey: connectKeys.premiumPlans(), queryFn: connectApi.getPremiumPlans });
}

export function useHelpArticles() {
  return useQuery({ queryKey: connectKeys.help(), queryFn: connectApi.getHelpArticles });
}

export function useLegalDocs() {
  return useQuery({ queryKey: connectKeys.legal(), queryFn: connectApi.getLegalDocs });
}

export function useRequestAccountDeletion() {
  return useMutation({ mutationFn: connectApi.requestAccountDeletion });
}
