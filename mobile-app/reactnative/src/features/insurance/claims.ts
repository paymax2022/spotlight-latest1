// ── Insurance — Claims data layer (IM2) ──────────────────────────────────────
// Self-contained mock-backed claims CRUD/FNOL/evidence/status, plus React Query
// hooks. ADDITIVE to IM1 — never edits api.ts/hooks.ts/types.ts. Provider JSON
// never leaks past this layer (PRD §7). Money is kobo (PRD §11).
//
// Claim lifecycle (PRD §10.2):
//   DRAFT → FNOL_SUBMITTED → UNDER_ASSESSMENT
//             ├─ NEEDS_MORE_INFO ↔ UNDER_ASSESSMENT
//             ├─ APPROVED → PAYOUT_PENDING → SETTLED
//             └─ REJECTED

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  INSURANCE_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
} from './constants/insurance.constants';
import { getPolicies } from './api';
import type { Disclosure, Policy, ProductLine, Provider } from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Claim domain (normalised, provider-agnostic) ─────────────────────────────
export type ClaimState =
  | 'DRAFT'
  | 'FNOL_SUBMITTED'
  | 'UNDER_ASSESSMENT'
  | 'NEEDS_MORE_INFO'
  | 'APPROVED'
  | 'PAYOUT_PENDING'
  | 'SETTLED'
  | 'REJECTED';

/** A field in a product/peril-driven FNOL form (schema-driven, like quotes). */
export interface ClaimFieldSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'currency' | 'textarea';
  required: boolean;
  placeholder?: string;
  helper?: string;
  options?: { value: string; label: string }[];
}

export interface ClaimEvidence {
  id: string;
  kind: 'photo' | 'document' | 'inspection';
  label: string;
  uri: string;            // local/preview uri (signed-url placeholder in live)
  uploadedAt: string;
  status: 'pending' | 'uploaded' | 'failed';
}

/** One step on the status tracker timeline. */
export interface ClaimTimelineEntry {
  state: ClaimState;
  label: string;
  note?: string;
  at: string | null;      // null = not reached yet
}

export interface Claim {
  id: string;
  policyId: string;
  policyName: string;
  productLine: ProductLine;
  provider: Provider;
  disclosure: Disclosure;
  state: ClaimState;
  perilCode: string;
  perilLabel: string;
  description: string;
  lossEventAt: string;
  reportedAt: string;
  claimedAmountKobo: number;
  approvedAmountKobo: number | null;
  payoutLedgerRef: string | null;   // set when SETTLED (credit to wallet)
  payoutAt: string | null;
  evidence: ClaimEvidence[];
  timeline: ClaimTimelineEntry[];
  /** Set when assessor asks for more info (NEEDS_MORE_INFO). */
  infoRequest?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimType {
  perilCode: string;
  perilLabel: string;
  description: string;
  productLines: ProductLine[];
  fieldsSchema: ClaimFieldSchema[];
}

// ── Friendly labels / ordering for the status tracker ─────────────────────────
export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  DRAFT: 'Draft',
  FNOL_SUBMITTED: 'Reported',
  UNDER_ASSESSMENT: 'Under assessment',
  NEEDS_MORE_INFO: 'More info needed',
  APPROVED: 'Approved',
  PAYOUT_PENDING: 'Payout pending',
  SETTLED: 'Settled',
  REJECTED: 'Rejected',
};

/** Canonical "happy path" order used to render the tracker. */
export const CLAIM_TRACKER_ORDER: ClaimState[] = [
  'FNOL_SUBMITTED',
  'UNDER_ASSESSMENT',
  'APPROVED',
  'PAYOUT_PENDING',
  'SETTLED',
];

// ── Claim types (peril → schema-driven FNOL form) ─────────────────────────────
export const CLAIM_TYPES: ClaimType[] = [
  {
    perilCode: 'health.admission',
    perilLabel: 'Hospital admission / treatment',
    description: 'Claim for an admission, treatment or medical expense.',
    productLines: ['HEALTH', 'PERSONAL_ACCIDENT'],
    fieldsSchema: [
      { key: 'facility', label: 'Hospital / clinic name', type: 'text', required: true, placeholder: 'e.g. Reddington Hospital' },
      { key: 'lossEventAt', label: 'Date of treatment', type: 'date', required: true },
      { key: 'claimedAmount', label: 'Amount claimed (₦)', type: 'currency', required: true, placeholder: '0' },
      { key: 'description', label: 'What happened?', type: 'textarea', required: true, helper: 'Briefly describe the incident and treatment received.' },
    ],
  },
  {
    perilCode: 'device.damage',
    perilLabel: 'Device damage / theft',
    description: 'Claim for a damaged, lost or stolen device.',
    productLines: ['DEVICE'],
    fieldsSchema: [
      { key: 'incidentType', label: 'Incident type', type: 'select', required: true, options: [
        { value: 'screen', label: 'Cracked screen' },
        { value: 'liquid', label: 'Liquid damage' },
        { value: 'theft', label: 'Theft' },
        { value: 'loss', label: 'Loss' },
      ] },
      { key: 'lossEventAt', label: 'Date of incident', type: 'date', required: true },
      { key: 'claimedAmount', label: 'Estimated repair / replacement (₦)', type: 'currency', required: true, placeholder: '0' },
      { key: 'description', label: 'What happened?', type: 'textarea', required: true },
    ],
  },
  {
    perilCode: 'motor.accident',
    perilLabel: 'Motor accident / damage',
    description: 'Claim for vehicle damage or a road incident.',
    productLines: ['MOTOR'],
    fieldsSchema: [
      { key: 'lossEventAt', label: 'Date of accident', type: 'date', required: true },
      { key: 'location', label: 'Location', type: 'text', required: true, placeholder: 'Where did it happen?' },
      { key: 'thirdParty', label: 'Third party involved?', type: 'select', required: true, options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ] },
      { key: 'claimedAmount', label: 'Estimated damage (₦)', type: 'currency', required: true, placeholder: '0' },
      { key: 'description', label: 'Describe the incident', type: 'textarea', required: true },
    ],
  },
  {
    perilCode: 'git.loss',
    perilLabel: 'Goods lost / damaged in transit',
    description: 'Claim for a parcel or consignment lost or damaged in transit.',
    productLines: ['GOODS_IN_TRANSIT'],
    fieldsSchema: [
      { key: 'lossEventAt', label: 'Date of loss', type: 'date', required: true },
      { key: 'trackingRef', label: 'Tracking / waybill ref', type: 'text', required: false, placeholder: 'Optional' },
      { key: 'claimedAmount', label: 'Declared value (₦)', type: 'currency', required: true, placeholder: '0' },
      { key: 'description', label: 'What happened to the goods?', type: 'textarea', required: true },
    ],
  },
  {
    perilCode: 'general.loss',
    perilLabel: 'General claim',
    description: 'File a claim against this cover.',
    productLines: ['GENERAL', 'SME', 'WALLET'],
    fieldsSchema: [
      { key: 'lossEventAt', label: 'Date of incident', type: 'date', required: true },
      { key: 'claimedAmount', label: 'Amount claimed (₦)', type: 'currency', required: true, placeholder: '0' },
      { key: 'description', label: 'Describe what happened', type: 'textarea', required: true },
    ],
  },
];

export function claimTypesForLine(line: ProductLine): ClaimType[] {
  const matches = CLAIM_TYPES.filter((t) => t.productLines.includes(line));
  return matches.length > 0 ? matches : CLAIM_TYPES.filter((t) => t.perilCode === 'general.loss');
}

// ── Mock store ───────────────────────────────────────────────────────────────
function timelineFor(state: ClaimState, base: string): ClaimTimelineEntry[] {
  const order: { state: ClaimState; label: string; note?: string }[] = [
    { state: 'FNOL_SUBMITTED', label: 'Claim reported', note: 'We received your first notice of loss.' },
    { state: 'UNDER_ASSESSMENT', label: 'Under assessment', note: 'The underwriter is reviewing your claim.' },
    { state: 'APPROVED', label: 'Approved', note: 'Your claim was approved.' },
    { state: 'PAYOUT_PENDING', label: 'Payout pending', note: 'Settling to your wallet.' },
    { state: 'SETTLED', label: 'Settled', note: 'Funds credited to your wallet.' },
  ];
  const idx = CLAIM_TRACKER_ORDER.indexOf(state);
  return order.map((o, i) => ({
    ...o,
    at: i <= idx ? new Date(new Date(base).getTime() + i * 36e5).toISOString() : null,
  }));
}

const MOCK_CLAIMS: Claim[] = [
  {
    id: 'clm-active01',
    policyId: 'pol-seed-health',
    policyName: 'MicroHealth Essential',
    productLine: 'HEALTH',
    provider: 'MYCOVER',
    disclosure: { underwriter: 'Hygeia HMO', aggregator: 'MyCover.ai' },
    state: 'UNDER_ASSESSMENT',
    perilCode: 'health.admission',
    perilLabel: 'Hospital admission / treatment',
    description: 'Two-night admission for malaria treatment at partner clinic.',
    lossEventAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    reportedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    claimedAmountKobo: 145_000_00,
    approvedAmountKobo: null,
    payoutLedgerRef: null,
    payoutAt: null,
    evidence: [
      { id: 'ev-1', kind: 'document', label: 'Discharge summary.pdf', uri: 'doc/discharge-mock.pdf', uploadedAt: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'uploaded' },
      { id: 'ev-2', kind: 'photo', label: 'Receipt.jpg', uri: 'doc/receipt-mock.jpg', uploadedAt: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'uploaded' },
    ],
    timeline: timelineFor('UNDER_ASSESSMENT', new Date(Date.now() - 5 * 86400000).toISOString()),
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'clm-settled01',
    policyId: 'pol-seed-device',
    policyName: 'Device Protect',
    productLine: 'DEVICE',
    provider: 'MYCOVER',
    disclosure: { underwriter: 'Sovereign Trust', aggregator: 'MyCover.ai' },
    state: 'SETTLED',
    perilCode: 'device.damage',
    perilLabel: 'Device damage / theft',
    description: 'Cracked screen after accidental drop.',
    lossEventAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    reportedAt: new Date(Date.now() - 19 * 86400000).toISOString(),
    claimedAmountKobo: 85_000_00,
    approvedAmountKobo: 78_000_00,
    payoutLedgerRef: 'ledger-payout-mock-9931',
    payoutAt: new Date(Date.now() - 16 * 86400000).toISOString(),
    evidence: [
      { id: 'ev-3', kind: 'photo', label: 'Damage photo.jpg', uri: 'doc/damage-mock.jpg', uploadedAt: new Date(Date.now() - 19 * 86400000).toISOString(), status: 'uploaded' },
    ],
    timeline: timelineFor('SETTLED', new Date(Date.now() - 19 * 86400000).toISOString()),
    createdAt: new Date(Date.now() - 19 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 16 * 86400000).toISOString(),
  },
];

let mockClaims: Claim[] = [...MOCK_CLAIMS];

// ── Read ──────────────────────────────────────────────────────────────────────
export async function getClaims(): Promise<Claim[]> {
  if (USE_MOCK) {
    await delay();
    return [...mockClaims].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }
  const { data } = await api.get<Claim[]>(`${INSURANCE_API_BASE}/claims`);
  return data;
}

export async function getClaim(id: string): Promise<Claim> {
  if (USE_MOCK) {
    await delay(200);
    const found = mockClaims.find((c) => c.id === id);
    if (!found) throw new Error('Claim not found');
    return found;
  }
  const { data } = await api.get<Claim>(`${INSURANCE_API_BASE}/claims/${id}`);
  return data;
}

/** Policies a claim can be filed against (ACTIVE / RENEWAL_DUE only). */
export async function getClaimablePolicies(): Promise<Policy[]> {
  const policies = await getPolicies();
  return policies.filter((p) => p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE');
}

// ── FNOL (first notice of loss) — Idempotency-Key REQUIRED (PRD §12.1) ─────────
export interface FnolInput {
  policyId: string;
  perilCode: string;
  inputs: Record<string, string>;
  idempotencyKey: string;
}

export async function submitFnol(input: FnolInput): Promise<Claim> {
  if (USE_MOCK) {
    await delay(800);
    const policies = await getPolicies();
    const policy = policies.find((p) => p.id === input.policyId);
    if (!policy) throw new Error('Policy not found');
    const type = CLAIM_TYPES.find((t) => t.perilCode === input.perilCode) ?? CLAIM_TYPES[CLAIM_TYPES.length - 1];
    const now = new Date().toISOString();
    const claimedAmountKobo = Math.round(Number(input.inputs.claimedAmount ?? 0) * 100);
    const claim: Claim = {
      id: uid('clm'),
      policyId: policy.id,
      policyName: policy.productName,
      productLine: policy.productLine,
      provider: policy.provider,
      disclosure: policy.disclosure,
      state: 'FNOL_SUBMITTED',
      perilCode: type.perilCode,
      perilLabel: type.perilLabel,
      description: input.inputs.description ?? '',
      lossEventAt: input.inputs.lossEventAt ?? now,
      reportedAt: now,
      claimedAmountKobo,
      approvedAmountKobo: null,
      payoutLedgerRef: null,
      payoutAt: null,
      evidence: [],
      timeline: timelineFor('FNOL_SUBMITTED', now),
      createdAt: now,
      updatedAt: now,
    };
    mockClaims = [claim, ...mockClaims];
    return claim;
  }
  const { data } = await api.post<Claim>(
    `${INSURANCE_API_BASE}/claims`,
    { policyId: input.policyId, perilCode: input.perilCode, inputs: input.inputs },
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return data;
}

// ── Evidence (signed-url placeholder) ────────────────────────────────────────
export interface EvidenceUploadInput {
  claimId: string;
  kind: ClaimEvidence['kind'];
  label: string;
  uri: string;
}

/** In live this requests a signed URL then PUTs the file; mock just records it. */
export async function uploadEvidence(input: EvidenceUploadInput): Promise<ClaimEvidence> {
  if (USE_MOCK) {
    await delay(600);
    const ev: ClaimEvidence = {
      id: uid('ev'),
      kind: input.kind,
      label: input.label,
      uri: input.uri,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    };
    mockClaims = mockClaims.map((c) =>
      c.id === input.claimId ? { ...c, evidence: [...c.evidence, ev], updatedAt: ev.uploadedAt } : c,
    );
    return ev;
  }
  // Live: request signed URL, upload, then register against the claim.
  const { data } = await api.post<ClaimEvidence>(
    `${INSURANCE_API_BASE}/claims/${input.claimId}/evidence`,
    { kind: input.kind, label: input.label },
  );
  return data;
}

// ── Settle (payout to wallet; PRD §10.2 PAYOUT_PENDING → SETTLED) ─────────────
// GAP: claims/register.go exposes no member-callable POST /claims/:id/settle —
// settlement/payout is admin-only (AdminDecision). This 404s in live mode until
// a member-facing endpoint (or an admin-triggered async payout the member polls
// for via GET /claims/:id) exists. Left correctly structured (Idempotency-Key
// attached) for when it lands.
// Idempotent on the claim's idempotency key in live. Mock advances the state
// machine to SETTLED and writes a payout ledger ref.
export async function settleClaim(args: { claimId: string; idempotencyKey: string }): Promise<Claim> {
  if (USE_MOCK) {
    await delay(900);
    const now = new Date().toISOString();
    mockClaims = mockClaims.map((c) => {
      if (c.id !== args.claimId) return c;
      const approved = c.approvedAmountKobo ?? Math.round(c.claimedAmountKobo * 0.9);
      return {
        ...c,
        state: 'SETTLED',
        approvedAmountKobo: approved,
        payoutLedgerRef: `ledger-payout-${uid('ref')}`,
        payoutAt: now,
        timeline: timelineFor('SETTLED', c.reportedAt),
        updatedAt: now,
      };
    });
    const updated = mockClaims.find((c) => c.id === args.claimId);
    if (!updated) throw new Error('Claim not found');
    return updated;
  }
  const { data } = await api.post<Claim>(
    `${INSURANCE_API_BASE}/claims/${args.claimId}/settle`,
    {},
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

// ── React Query hooks ─────────────────────────────────────────────────────────
const KEY = 'insurance-claims';

export function useClaims() {
  return useQuery({ queryKey: [KEY, 'list'], queryFn: getClaims, staleTime: 30_000 });
}

export function useClaim(id: string) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => getClaim(id),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useClaimablePolicies() {
  return useQuery({
    queryKey: [KEY, 'claimable-policies'],
    queryFn: getClaimablePolicies,
    staleTime: 30_000,
  });
}

export function useSubmitFnol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FnolInput) => submitFnol(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'list'] });
    },
  });
}

export function useUploadEvidence(claimId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EvidenceUploadInput, 'claimId'>) =>
      uploadEvidence({ ...input, claimId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'detail', claimId] });
    },
  });
}

export function useSettleClaim(claimId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => settleClaim({ claimId, idempotencyKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'detail', claimId] });
      qc.invalidateQueries({ queryKey: [KEY, 'list'] });
    },
  });
}
