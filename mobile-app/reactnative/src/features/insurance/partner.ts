// ── Insurance — Partner/driver data layer (IM2) ──────────────────────────────
// Embedded mobility cover for transport partners (PRD §13 / §15.3). A driver sees
// their embedded policies, current trip/job cover status, files an embedded claim,
// uploads inspection photos, tracks claim status, and consents to onboarding
// cover. Claims reuse the IM2 claims layer types/state machine. ADDITIVE to IM1.
// Money is kobo.
//
// GAP (whole file): no `/partner/*` routes exist anywhere on the Go insurance
// surface (grepped backend/internal/insurance/** and backend/internal/app/
// insurance*_routes.go — zero matches for "partner"). Every live-mode call in
// this file (policies, trip-cover, claims, onboarding-consent) 404s today. This
// is a genuinely missing backend module, not a wrong-path bug — report upstream
// before flipping any partner-facing screen live.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  INSURANCE_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
} from './constants/insurance.constants';
import type { Disclosure, Provider } from './types';
import type { Claim, ClaimEvidence } from './claims';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Partner embedded policy ───────────────────────────────────────────────────
export type PartnerPolicyKind = 'DRIVER_PROTECTION' | 'MOTOR' | 'PASSENGER' | 'GIT';

export interface PartnerPolicy {
  id: string;
  kind: PartnerPolicyKind;
  productName: string;
  provider: Provider;
  disclosure: Disclosure;
  state: 'ACTIVE' | 'RENEWAL_DUE' | 'EXPIRED';
  sumInsuredKobo: number;
  premiumKobo: number;
  premiumCadence: 'annual' | 'per-trip' | 'per-shipment';
  effectiveAt: string;
  expiresAt: string;
  icon: string;
}

/** Live cover status for the current trip/job. */
export interface TripCoverStatus {
  hasActiveJob: boolean;
  jobId?: string;
  jobLabel?: string;
  covered: boolean;
  productName?: string;
  provider?: Provider;
  disclosure?: Disclosure;
  sumInsuredKobo?: number;
  startedAt?: string;
}

export interface OnboardingConsent {
  productName: string;
  provider: Provider;
  disclosure: Disclosure;
  premiumKobo: number;
  premiumCadence: 'annual';
  sumInsuredKobo: number;
  fields: string[];          // minimised PII shared with provider (NDPA §18)
  benefits: string[];
  accepted: boolean;
}

// ── Mock store ───────────────────────────────────────────────────────────────
const MOCK_PARTNER_POLICIES: PartnerPolicy[] = [
  {
    id: 'ppol-driver-01', kind: 'DRIVER_PROTECTION', productName: 'Driver Protection (Annual)',
    provider: 'OCTAMILE', disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
    state: 'ACTIVE', sumInsuredKobo: 3_000_000_00, premiumKobo: 18_000_00, premiumCadence: 'annual',
    effectiveAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 305 * 86400000).toISOString(), icon: 'ShieldCheck',
  },
  {
    id: 'ppol-motor-01', kind: 'MOTOR', productName: 'Motor Third-Party',
    provider: 'OCTAMILE', disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
    state: 'RENEWAL_DUE', sumInsuredKobo: 1_000_000_00, premiumKobo: 15_000_00, premiumCadence: 'annual',
    effectiveAt: new Date(Date.now() - 350 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 12 * 86400000).toISOString(), icon: 'Car',
  },
];

let mockPartnerClaims: Claim[] = [
  {
    id: 'pclm-01', policyId: 'ppol-driver-01', policyName: 'Driver Protection (Annual)',
    productLine: 'MOTOR', provider: 'OCTAMILE', disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
    state: 'UNDER_ASSESSMENT', perilCode: 'motor.accident', perilLabel: 'Motor accident / damage',
    description: 'Rear-ended at a junction during a trip.',
    lossEventAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    reportedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    claimedAmountKobo: 220_000_00, approvedAmountKobo: null, payoutLedgerRef: null, payoutAt: null,
    evidence: [
      { id: 'pev-1', kind: 'inspection', label: 'Front bumper.jpg', uri: 'doc/inspect-mock.jpg', uploadedAt: new Date(Date.now() - 3 * 86400000).toISOString(), status: 'uploaded' },
    ],
    timeline: [
      { state: 'FNOL_SUBMITTED', label: 'Claim reported', note: 'FNOL received from driver app.', at: new Date(Date.now() - 3 * 86400000).toISOString() },
      { state: 'UNDER_ASSESSMENT', label: 'Under assessment', note: 'Remote inspection in progress.', at: new Date(Date.now() - 2 * 86400000).toISOString() },
      { state: 'APPROVED', label: 'Approved', at: null },
      { state: 'PAYOUT_PENDING', label: 'Payout pending', at: null },
      { state: 'SETTLED', label: 'Settled', at: null },
    ],
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

let mockOnboardingConsent: OnboardingConsent = {
  productName: 'Driver Protection (Annual)',
  provider: 'OCTAMILE',
  disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
  premiumKobo: 18_000_00,
  premiumCadence: 'annual',
  sumInsuredKobo: 3_000_000_00,
  fields: ['Full name', 'Phone number', "Driver's licence", 'Vehicle plate number'],
  benefits: ['Accidental injury cover while on duty', 'Third-party liability', 'Emergency medical expenses', 'Fast-track motor claims'],
  accepted: false,
};

// ── Read ──────────────────────────────────────────────────────────────────────
export async function getPartnerPolicies(): Promise<PartnerPolicy[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PARTNER_POLICIES;
  }
  const { data } = await api.get<PartnerPolicy[]>(`${INSURANCE_API_BASE}/partner/policies`);
  return data;
}

export async function getTripCoverStatus(): Promise<TripCoverStatus> {
  if (USE_MOCK) {
    await delay(220);
    return {
      hasActiveJob: true,
      jobId: 'trip-active-77',
      jobLabel: 'Ikeja → Lekki Phase 1',
      covered: true,
      productName: 'Passenger + Driver Per-Trip',
      provider: 'OCTAMILE',
      disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
      sumInsuredKobo: 2_000_000_00,
      startedAt: new Date(Date.now() - 18 * 60000).toISOString(),
    };
  }
  const { data } = await api.get<TripCoverStatus>(`${INSURANCE_API_BASE}/partner/trip-cover`);
  return data;
}

export async function getPartnerClaims(): Promise<Claim[]> {
  if (USE_MOCK) {
    await delay();
    return [...mockPartnerClaims].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }
  const { data } = await api.get<Claim[]>(`${INSURANCE_API_BASE}/partner/claims`);
  return data;
}

export async function getPartnerClaim(id: string): Promise<Claim> {
  if (USE_MOCK) {
    await delay(200);
    const found = mockPartnerClaims.find((c) => c.id === id);
    if (!found) throw new Error('Claim not found');
    return found;
  }
  const { data } = await api.get<Claim>(`${INSURANCE_API_BASE}/partner/claims/${id}`);
  return data;
}

export async function getOnboardingConsent(): Promise<OnboardingConsent> {
  if (USE_MOCK) {
    await delay(200);
    return mockOnboardingConsent;
  }
  const { data } = await api.get<OnboardingConsent>(`${INSURANCE_API_BASE}/partner/onboarding-consent`);
  return data;
}

// ── Mutations ─────────────────────────────────────────────────────────────────
// File an embedded claim against an active partner policy — Idempotency-Key on FNOL.
export async function filePartnerClaim(args: {
  policyId: string;
  inputs: Record<string, string>;
  idempotencyKey: string;
}): Promise<Claim> {
  if (USE_MOCK) {
    await delay(800);
    const policy = MOCK_PARTNER_POLICIES.find((p) => p.id === args.policyId) ?? MOCK_PARTNER_POLICIES[0];
    const now = new Date().toISOString();
    const claim: Claim = {
      id: uid('pclm'),
      policyId: policy.id,
      policyName: policy.productName,
      productLine: 'MOTOR',
      provider: policy.provider,
      disclosure: policy.disclosure,
      state: 'FNOL_SUBMITTED',
      perilCode: 'motor.accident',
      perilLabel: 'Motor accident / damage',
      description: args.inputs.description ?? '',
      lossEventAt: args.inputs.lossEventAt ?? now,
      reportedAt: now,
      claimedAmountKobo: Math.round(Number(args.inputs.claimedAmount ?? 0) * 100),
      approvedAmountKobo: null,
      payoutLedgerRef: null,
      payoutAt: null,
      evidence: [],
      timeline: [
        { state: 'FNOL_SUBMITTED', label: 'Claim reported', note: 'FNOL received from driver app.', at: now },
        { state: 'UNDER_ASSESSMENT', label: 'Under assessment', at: null },
        { state: 'APPROVED', label: 'Approved', at: null },
        { state: 'PAYOUT_PENDING', label: 'Payout pending', at: null },
        { state: 'SETTLED', label: 'Settled', at: null },
      ],
      createdAt: now,
      updatedAt: now,
    };
    mockPartnerClaims = [claim, ...mockPartnerClaims];
    return claim;
  }
  const { data } = await api.post<Claim>(
    `${INSURANCE_API_BASE}/partner/claims`,
    { policyId: args.policyId, inputs: args.inputs },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

export async function uploadInspection(args: {
  claimId: string;
  label: string;
  uri: string;
}): Promise<ClaimEvidence> {
  if (USE_MOCK) {
    await delay(600);
    const ev: ClaimEvidence = {
      id: uid('pev'),
      kind: 'inspection',
      label: args.label,
      uri: args.uri,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    };
    mockPartnerClaims = mockPartnerClaims.map((c) =>
      c.id === args.claimId ? { ...c, evidence: [...c.evidence, ev], updatedAt: ev.uploadedAt } : c,
    );
    return ev;
  }
  const { data } = await api.post<ClaimEvidence>(
    `${INSURANCE_API_BASE}/partner/claims/${args.claimId}/inspection`,
    { label: args.label },
  );
  return data;
}

export async function acceptOnboardingConsent(args: { idempotencyKey: string }): Promise<OnboardingConsent> {
  if (USE_MOCK) {
    await delay(700);
    mockOnboardingConsent = { ...mockOnboardingConsent, accepted: true };
    return mockOnboardingConsent;
  }
  const { data } = await api.post<OnboardingConsent>(
    `${INSURANCE_API_BASE}/partner/onboarding-consent`,
    {},
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

// ── React Query hooks ─────────────────────────────────────────────────────────
const KEY = 'insurance-partner';

export function usePartnerPolicies() {
  return useQuery({ queryKey: [KEY, 'policies'], queryFn: getPartnerPolicies, staleTime: 30_000 });
}

export function useTripCoverStatus() {
  return useQuery({ queryKey: [KEY, 'trip-cover'], queryFn: getTripCoverStatus, staleTime: 10_000 });
}

export function usePartnerClaims() {
  return useQuery({ queryKey: [KEY, 'claims'], queryFn: getPartnerClaims, staleTime: 20_000 });
}

export function usePartnerClaim(id: string) {
  return useQuery({
    queryKey: [KEY, 'claim', id],
    queryFn: () => getPartnerClaim(id),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useOnboardingConsent() {
  return useQuery({ queryKey: [KEY, 'onboarding-consent'], queryFn: getOnboardingConsent, staleTime: 60_000 });
}

export function useFilePartnerClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { policyId: string; inputs: Record<string, string>; idempotencyKey: string }) =>
      filePartnerClaim(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'claims'] }),
  });
}

export function useUploadInspection(claimId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { label: string; uri: string }) => uploadInspection({ ...args, claimId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'claim', claimId] }),
  });
}

export function useAcceptOnboardingConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => acceptOnboardingConsent({ idempotencyKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'onboarding-consent'] }),
  });
}
