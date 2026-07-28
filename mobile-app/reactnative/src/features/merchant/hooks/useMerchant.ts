// ── Merchant Onboarding — data hooks (react-query) ───────────────────────────
// Reads expose loading/error/empty to the screens; mutations auto-generate the
// Idempotency-Key and invalidate the relevant queries. Mirrors the doctor hooks.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as merchantApi from '../api/merchant.api';
import type { ApplicationData, CreateApplicationInput } from '@/types/merchant';

const keys = {
  modules:       ['merchant', 'modules'] as const,
  types:         (moduleId: string) => ['merchant', 'types', moduleId] as const,
  type:          (typeId: string) => ['merchant', 'type', typeId] as const,
  schema:        (schemaId: string) => ['merchant', 'schema', schemaId] as const,
  capabilities:  ['merchant', 'capabilities'] as const,
  application:   (id: string) => ['merchant', 'application', id] as const,
};

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useModules() {
  return useQuery({ queryKey: keys.modules, queryFn: merchantApi.listModules, staleTime: 60_000 });
}

export function useMerchantTypes(moduleId?: string) {
  return useQuery({
    queryKey: keys.types(moduleId ?? ''),
    queryFn:  () => merchantApi.listMerchantTypes(moduleId!),
    enabled:  !!moduleId,
    staleTime: 60_000,
  });
}

export function useMerchantType(typeId?: string) {
  return useQuery({
    queryKey: keys.type(typeId ?? ''),
    queryFn:  () => merchantApi.getMerchantType(typeId!),
    enabled:  !!typeId,
  });
}

export function useFormSchema(schemaId?: string) {
  return useQuery({
    queryKey: keys.schema(schemaId ?? ''),
    queryFn:  () => merchantApi.getFormSchema(schemaId!),
    enabled:  !!schemaId,
  });
}

export function useCapabilities() {
  return useQuery({ queryKey: keys.capabilities, queryFn: merchantApi.getMyCapabilities, staleTime: 15_000 });
}

export function useApplication(id?: string) {
  return useQuery({
    queryKey: keys.application(id ?? ''),
    queryFn:  () => merchantApi.getApplication(id!),
    enabled:  !!id,
    // Poll while in-flight so SUBMITTED → UNDER_REVIEW surfaces in the demo.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'SUBMITTED' || s === 'UNDER_REVIEW' ? 4000 : false;
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApplicationInput) => merchantApi.createApplication(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: keys.capabilities }),
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { applicationId: string; data: ApplicationData }) => merchantApi.saveDraft(vars),
    onSuccess:  (app) => {
      qc.invalidateQueries({ queryKey: keys.application(app.id) });
      qc.invalidateQueries({ queryKey: keys.capabilities });
    },
  });
}

export function useSubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { applicationId: string; data: ApplicationData }) =>
      merchantApi.submitApplication({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (app) => {
      qc.invalidateQueries({ queryKey: keys.application(app.id) });
      qc.invalidateQueries({ queryKey: keys.capabilities });
    },
  });
}

export function useResubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { applicationId: string; data: ApplicationData }) =>
      merchantApi.resubmitApplication({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (app) => {
      qc.invalidateQueries({ queryKey: keys.application(app.id) });
      qc.invalidateQueries({ queryKey: keys.capabilities });
    },
  });
}
