// ── Insurance — Embedded cover data layer (IM2) ──────────────────────────────
// Powers the shared CoverBadge affordance (transport & parcel checkout) and the
// opt-in flows (wallet-insurance, device-cover). ADDITIVE to IM1. Money is kobo.
//
// Embedded bind (PRD §10.3) is idempotent on `sourceEventId` — a replayed trip /
// parcel / opt-in event never double-binds. The actual wallet debit goes through
// the shared PaymentSheet; `bindEmbeddedCover` is the "charge" that binds AFTER
// funds are guaranteed (debit→bind saga, PRD §11). On failure the hold is
// released / premium auto-reversed (UNCOVERED), surfaced to the user.
//
// GAP (whole file): the Go embedded engine (backend/internal/insurance/embedded/
// register.go) only exposes POST /embedded/events (trigger a bind from an
// upstream module event) and GET /embedded/events (list known event types) — an
// event-push model driven by other modules' emit points, NOT the REST
// offer/get/bind-by-id shape this file calls (`/embedded/cover/:id`,
// `/embedded/policies/:id`, `/embedded/bind`). None of those three mobile-facing
// paths exist on Go yet; all three 404 in live mode. This needs either (a) new
// Go handlers matching this REST shape, or (b) this file rewritten to POST
// /embedded/events with a `source_event_id` and poll policy state via the IM1
// GET /policies list instead. Left mock-first pending that decision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  INSURANCE_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
} from './constants/insurance.constants';
import type { Disclosure, Policy, Provider } from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Embedded-cover surface (a trip / parcel / wallet / device context) ─────────
export type CoverContext = 'TRIP' | 'PARCEL' | 'WALLET' | 'DEVICE';

/** Cover status for an inline affordance (CoverBadge). */
export type CoverStatus = 'INSURED' | 'AVAILABLE' | 'UNCOVERED' | 'BINDING';

export interface EmbeddedCoverOffer {
  /** Stable id for the host context (trip id, parcel id, "wallet", etc.). */
  sourceEventId: string;
  context: CoverContext;
  status: CoverStatus;
  productCode: string;
  productName: string;
  provider: Provider;
  disclosure: Disclosure;
  premiumKobo: number;
  premiumCadence: 'per-trip' | 'per-shipment' | 'monthly' | 'annual' | 'one-off';
  sumInsuredKobo: number;
  /** Set once cover is bound (links to the policy wallet). */
  policyId?: string;
  benefits: string[];
  /** Whether this cover is voluntary opt-in vs auto-attached embedded. */
  voluntary: boolean;
}

// ── Mock offers keyed by source event id ─────────────────────────────────────
const baseOffers: Record<string, EmbeddedCoverOffer> = {
  // Trip / parcel demo contexts reachable from cover/[policyId] mini view.
  'trip-demo-001': {
    sourceEventId: 'trip-demo-001',
    context: 'TRIP',
    status: 'INSURED',
    productCode: 'octamile.trip.passenger.v1',
    productName: 'Trip Protection',
    provider: 'OCTAMILE',
    disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
    premiumKobo: 150_00,
    premiumCadence: 'per-trip',
    sumInsuredKobo: 2_000_000_00,
    policyId: 'pol-embedded-trip',
    benefits: ['Accidental injury during the trip', 'Emergency medical expenses', 'Personal effects in the vehicle'],
    voluntary: false,
  },
  'parcel-demo-001': {
    sourceEventId: 'parcel-demo-001',
    context: 'PARCEL',
    status: 'AVAILABLE',
    productCode: 'octamile.git.parcel.v1',
    productName: 'Parcel Protection (GIT)',
    provider: 'OCTAMILE',
    disclosure: { underwriter: 'AXA Mansard', aggregator: 'Octamile' },
    premiumKobo: 350_00,
    premiumCadence: 'per-shipment',
    sumInsuredKobo: 150_000_00,
    benefits: ['Loss or damage in transit', 'Cover up to declared value', 'Fast-track claims'],
    voluntary: false,
  },
  // Opt-in contexts.
  wallet: {
    sourceEventId: 'wallet',
    context: 'WALLET',
    status: 'AVAILABLE',
    productCode: 'mycover.wallet.protect.v1',
    productName: 'Wallet Protection',
    provider: 'MYCOVER',
    disclosure: { underwriter: 'AIICO Insurance', aggregator: 'MyCover.ai' },
    premiumKobo: 200_00,
    premiumCadence: 'monthly',
    sumInsuredKobo: 500_000_00,
    benefits: ['Unauthorised-transaction protection', 'Fraud-loss reimbursement', 'Up to ₦500,000 / year'],
    voluntary: true,
  },
  device: {
    sourceEventId: 'device',
    context: 'DEVICE',
    status: 'AVAILABLE',
    productCode: 'mycover.device.protect.v1',
    productName: 'Device Protect',
    provider: 'MYCOVER',
    disclosure: { underwriter: 'Sovereign Trust', aggregator: 'MyCover.ai' },
    premiumKobo: 450_00,
    premiumCadence: 'monthly',
    sumInsuredKobo: 350_000_00,
    benefits: ['Accidental & liquid damage', 'Theft cover', 'Screen repair'],
    voluntary: true,
  },
};

let mockOffers: Record<string, EmbeddedCoverOffer> = { ...baseOffers };

// ── Read ──────────────────────────────────────────────────────────────────────
export async function getCoverOffer(sourceEventId: string): Promise<EmbeddedCoverOffer | null> {
  if (USE_MOCK) {
    await delay(220);
    return mockOffers[sourceEventId] ?? null;
  }
  const { data } = await api.get<EmbeddedCoverOffer | null>(
    `${INSURANCE_API_BASE}/embedded/cover/${encodeURIComponent(sourceEventId)}`,
  );
  return data;
}

/** Mini policy/cover view reachable from a trip/parcel. */
export async function getEmbeddedCover(policyId: string): Promise<EmbeddedCoverOffer> {
  if (USE_MOCK) {
    await delay(220);
    const found = Object.values(mockOffers).find((o) => o.policyId === policyId)
      ?? Object.values(mockOffers).find((o) => o.sourceEventId === policyId);
    if (!found) throw new Error('Cover not found');
    return found;
  }
  const { data } = await api.get<EmbeddedCoverOffer>(
    `${INSURANCE_API_BASE}/embedded/policies/${encodeURIComponent(policyId)}`,
  );
  return data;
}

// ── Bind embedded / opt-in cover (debit→bind saga; idempotent on sourceEventId)─
export interface BindEmbeddedResult {
  ok: boolean;
  policy?: Policy;
  errorCode?: 'INSUFFICIENT_FUNDS' | 'PROVIDER_UNAVAILABLE' | 'DUPLICATE_REQUEST';
  errorMessage?: string;
}

export async function bindEmbeddedCover(args: {
  sourceEventId: string;
  idempotencyKey: string;
}): Promise<BindEmbeddedResult> {
  if (USE_MOCK) {
    await delay(900);
    const offer = mockOffers[args.sourceEventId];
    if (!offer) {
      return { ok: false, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'Cover offer expired. Your wallet was not charged.' };
    }
    // Idempotent on sourceEventId: replay returns the already-bound state.
    if (offer.status === 'INSURED' && offer.policyId) {
      return { ok: true, policy: toPolicy(offer) };
    }
    const policyId = uid('pol-emb');
    const bound: EmbeddedCoverOffer = { ...offer, status: 'INSURED', policyId };
    mockOffers = { ...mockOffers, [args.sourceEventId]: bound };
    return { ok: true, policy: toPolicy(bound) };
  }
  const { data } = await api.post<BindEmbeddedResult>(
    `${INSURANCE_API_BASE}/embedded/bind`,
    { sourceEventId: args.sourceEventId },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

function toPolicy(o: EmbeddedCoverOffer): Policy {
  const now = new Date();
  const expires = new Date(now);
  if (o.premiumCadence === 'monthly') expires.setMonth(expires.getMonth() + 1);
  else expires.setFullYear(expires.getFullYear() + 1);
  return {
    id: o.policyId ?? uid('pol'),
    productCode: o.productCode,
    productName: o.productName,
    productLine: o.context === 'WALLET' ? 'WALLET' : o.context === 'DEVICE' ? 'DEVICE' : o.context === 'PARCEL' ? 'GOODS_IN_TRANSIT' : 'MOTOR',
    provider: o.provider,
    disclosure: o.disclosure,
    state: 'ACTIVE',
    bindingMode: o.voluntary ? 'VOLUNTARY' : 'EMBEDDED',
    sumInsuredKobo: o.sumInsuredKobo,
    premiumKobo: o.premiumKobo,
    premiumCadence: o.premiumCadence,
    currency: 'NGN',
    effectiveAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    certificateRef: `cert/${uid('cert')}-signed.pdf`,
    beneficiaries: [],
    icon: o.context === 'WALLET' ? 'Wallet' : o.context === 'DEVICE' ? 'Smartphone' : o.context === 'PARCEL' ? 'Package' : 'Car',
    refundState: 'NONE',
    createdAt: now.toISOString(),
  };
}

// ── React Query hooks ─────────────────────────────────────────────────────────
const KEY = 'insurance-embedded';

export function useCoverOffer(sourceEventId: string) {
  return useQuery({
    queryKey: [KEY, 'offer', sourceEventId],
    queryFn: () => getCoverOffer(sourceEventId),
    enabled: !!sourceEventId,
    staleTime: 20_000,
  });
}

export function useEmbeddedCover(policyId: string) {
  return useQuery({
    queryKey: [KEY, 'cover', policyId],
    queryFn: () => getEmbeddedCover(policyId),
    enabled: !!policyId,
    staleTime: 20_000,
  });
}

export function useBindEmbeddedCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sourceEventId: string; idempotencyKey: string }) => bindEmbeddedCover(args),
    onSuccess: (res, vars) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: [KEY, 'offer', vars.sourceEventId] });
        qc.invalidateQueries({ queryKey: ['insurance', 'policies'] });
        qc.invalidateQueries({ queryKey: ['insurance', 'cover-summary'] });
      }
    },
  });
}
