// ── Property roles — React Query hooks ───────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { propertyKeys } from '../hooks';
import { moduleQueryOptions } from '@/lib/moduleAvailability';
import type { ProfessionalRole } from './requirements';
import type { RegisterRoleInput, UpdateRoleInput, UploadRoleDocumentInput } from './types';

export const roleKeys = {
  all: [...propertyKeys.all, 'roles'] as const,
  mine: () => [...propertyKeys.all, 'roles', 'mine'] as const,
};

export function useMyRoleProfiles() {
  return useQuery({
    queryKey: roleKeys.mine(),
    queryFn: api.listMyRoleProfiles,
    ...moduleQueryOptions(),
  });
}

function useRoleInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: roleKeys.all });
    // Verified roles also surface as read-only context entities.
    qc.invalidateQueries({ queryKey: propertyKeys.context() });
  };
}

export function useRegisterRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (input: RegisterRoleInput) => api.registerRole(input),
    onSuccess: invalidate,
  });
}

export function useUpdateRoleProfile(role: ProfessionalRole) {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) => api.updateRoleProfile(role, input),
    onSuccess: invalidate,
  });
}

export function useSubmitRoleForVerification(role: ProfessionalRole) {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: () => api.submitRoleForVerification(role),
    onSuccess: invalidate,
  });
}

export function useUploadRoleDocument(role: ProfessionalRole) {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (input: UploadRoleDocumentInput) => api.uploadRoleDocument(role, input),
    onSuccess: invalidate,
  });
}
