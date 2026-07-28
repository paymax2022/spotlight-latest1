// ── Multi-provider KYC step-up — data hooks ──────────────────────────────────
// React Query wrappers over the /api/finance/kyc contract. Check mutations
// invalidate the session query so the UI re-derives progress after each attempt.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as kyc from './api';
import type {
  VerificationSession,
  ConsentScope,
  KycTier,
  IdType,
  DocType,
} from './types';

const KEY = 'kyc-verify';

/** GET /session/{id}. Poll-friendly: pass pollMs to enable K11 polling. */
export function useKycSession(sessionId: string | null | undefined, pollMs?: number) {
  return useQuery<VerificationSession>({
    queryKey: [KEY, 'session', sessionId],
    queryFn: () => kyc.getSession(sessionId as string),
    enabled: !!sessionId,
    refetchInterval: pollMs && sessionId ? pollMs : false,
    staleTime: 5_000,
  });
}

/** POST /session — start a step-up session for a target tier. */
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetTier: KycTier) => kyc.createSession(targetTier),
    onSuccess: (s) => qc.setQueryData([KEY, 'session', s.id], s),
  });
}

/** POST /consent — gate: must succeed before any check mutation runs. */
export function usePostConsent() {
  return useMutation({
    mutationFn: (v: { scope: ConsentScope; version: string }) => kyc.postConsent(v.scope, v.version),
  });
}

function invalidateSession(qc: ReturnType<typeof useQueryClient>, sessionId: string) {
  qc.invalidateQueries({ queryKey: [KEY, 'session', sessionId] });
}

export function useIdNumberCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: kyc.IdNumberCheckInput) => kyc.checkIdNumber(input),
    onSuccess: (_c, input) => invalidateSession(qc, input.sessionId),
  });
}

export function useLivenessCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; selfieB64: string }) => kyc.checkLiveness(input),
    onSuccess: (_c, input) => invalidateSession(qc, input.sessionId),
  });
}

export function useFacialCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; idType: IdType; idNumber: string; selfieB64: string }) =>
      kyc.checkFacial(input),
    onSuccess: (_c, input) => invalidateSession(qc, input.sessionId),
  });
}

export function useDocumentCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string; docType: DocType; frontB64: string; backB64?: string }) =>
      kyc.checkDocument(input),
    onSuccess: (_c, input) => invalidateSession(qc, input.sessionId),
  });
}

export function useAmlCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => kyc.checkAml(sessionId),
    onSuccess: (_c, sessionId) => invalidateSession(qc, sessionId),
  });
}

/** POST /sdk-token — fetch a server-issued token for a provider capture SDK. */
export function useSdkToken() {
  return useMutation({ mutationFn: (provider: string) => kyc.getSdkToken(provider) });
}
