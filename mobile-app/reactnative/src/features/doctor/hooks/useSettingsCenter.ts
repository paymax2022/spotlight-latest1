// ── Doctor — Settings Centre hooks (Batch 7, Section AC) ─────────────────────
// Query keys under ['doctor', 'settings', …] / ['doctor', 'security', …]. Mutations
// auto-generate the idempotencyKey. REUSES the Phase 1 useSettings /
// useUpdateSettings (useAccount.ts) for the profile / notification / availability
// toggles; this file adds the security settings, devices, app preferences and the
// change-password / biometric / 2FA / revoke-device / app-preference / logout
// mutations. Hook names are deliberately distinct from useSettings to avoid a
// barrel collision.
//
// CONSOLIDATED: account deletion is a SINGLE mutation — useRequestAccountDeletion
// lives in useComplianceCenter (Section AB). The AC delete-account screen imports
// it from there; it is intentionally NOT re-declared here to keep exactly one.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSecuritySettings,
  getDevices,
  getAppPreferences,
  changePassword,
  setBiometric,
  setTwoFactor,
  revokeDevice,
  updateAppPreferences,
  logout,
  DEMO_SECURITY_SETTINGS,
  DEMO_DEVICES,
  DEMO_APP_PREFERENCES,
} from '@/api/doctor.batch7.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  ChangePasswordInput,
  SetBiometricInput,
  SetTwoFactorInput,
  RevokeDeviceInput,
  UpdateAppPreferencesInput,
  LogoutInput,
} from '@/types/doctor.batch7';

// ─── Reads ────────────────────────────────────────────────────────────────────

export function useSecuritySettings() {
  return useQuery({
    queryKey:        ['doctor', 'security', 'settings'],
    queryFn:         getSecuritySettings,
    placeholderData: DEMO_SECURITY_SETTINGS,
    staleTime:       60_000,
  });
}

export function useDevices() {
  return useQuery({
    queryKey:        ['doctor', 'security', 'devices'],
    queryFn:         getDevices,
    placeholderData: DEMO_DEVICES,
    staleTime:       30_000,
  });
}

export function useAppPreferences() {
  return useQuery({
    queryKey:        ['doctor', 'settings', 'app-preferences'],
    queryFn:         getAppPreferences,
    placeholderData: DEMO_APP_PREFERENCES,
    staleTime:       60_000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ChangePasswordInput, 'idempotencyKey'>) =>
      changePassword({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'security', 'settings'] });
    },
  });
}

export function useSetBiometric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetBiometricInput, 'idempotencyKey'>) =>
      setBiometric({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'security', 'settings'] });
    },
  });
}

export function useSetTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetTwoFactorInput, 'idempotencyKey'>) =>
      setTwoFactor({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'security', 'settings'] });
    },
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<RevokeDeviceInput, 'idempotencyKey'>) =>
      revokeDevice({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'security', 'devices'] });
    },
  });
}

export function useUpdateAppPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateAppPreferencesInput, 'idempotencyKey'>) =>
      updateAppPreferences({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor', 'settings', 'app-preferences'] });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: (input?: Omit<LogoutInput, 'idempotencyKey'>) =>
      logout({ ...(input ?? {}), idempotencyKey: generateIdempotencyKey() }),
  });
}
