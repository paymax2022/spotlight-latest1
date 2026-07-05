// ── Paymax Black (Phase 3) ───────────────────────────────────────────────────
// Black extends the P2 loyalty ladder (TIER3 → BLACK). NEW file alongside the P2
// loyalty lib (do NOT edit P2 files). Reuses the P2 loyalty constants helpers.
// Perks redeem via a single-use credential at events; partner offers settle off
// the partner-offer ledger.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { USE_MOCK, API_BASE, formatNaira, formatPoints } from './constants/loyalty.constants';

export { formatNaira, formatPoints };

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
function blackIdempotencyKey(): string {
  return `blk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

// Threshold to unlock Black (lifetime points). Display mirror of backend config.
export const BLACK_THRESHOLD_POINTS = 50_000;

export const BLACK_BENEFITS = [
  'Early-access tickets to Spotlight events',
  'Members-only lounge entry at partner venues',
  'Zero transfer & FX fees',
  'Dedicated 24/7 concierge',
  'Exclusive partner offers & perks',
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────
export type BlackEligibility = 'eligible' | 'enrolled' | 'locked';

export interface BlackStatus {
  /** Is the member already on Black? */
  isBlack:        boolean;
  eligibility:    BlackEligibility;
  lifetimePoints: number;
  pointsToUnlock: number;       // 0 once eligible/enrolled
  memberSinceISO: string | null;
}

export type PerkKind = 'event' | 'lounge' | 'fee' | 'concierge';

export interface BlackPerk {
  id:          string;
  title:       string;
  description: string;
  kind:        PerkKind;
  /** Redeemed via single-use credential at the venue. */
  redeemable:  boolean;
  emoji:       string;
}

export interface PartnerOffer {
  id:          string;
  partner:     string;
  title:       string;
  description: string;
  /** Value of the offer for display (kobo); null = non-monetary perk. */
  valueKobo:   number | null;
  category:    string;
  expiresAtISO: string;
  thumbColor:  string;
}

export interface RedeemPerkInput {
  perkId: string;
}

export interface PerkCredential {
  ok:        boolean;
  /** Single-use credential token presented at the venue. */
  token:     string;
  perkTitle: string;
  expiresAtISO: string;
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_STATUS: BlackStatus = {
  isBlack: false,
  eligibility: 'eligible',
  lifetimePoints: 62_400,
  pointsToUnlock: 0,
  memberSinceISO: null,
};

const MOCK_PERKS: BlackPerk[] = [
  { id: 'pk_early',     title: 'Early-access tickets', description: 'Unlock event tickets 48h before general sale.', kind: 'event',     redeemable: true,  emoji: '🎫' },
  { id: 'pk_lounge',    title: 'Lounge access',        description: 'Skip the queue — enter the Black lounge at partner venues.', kind: 'lounge', redeemable: true, emoji: '🛋️' },
  { id: 'pk_fees',      title: 'Zero fees',            description: 'No transfer or FX fees on your account.',       kind: 'fee',       redeemable: false, emoji: '💸' },
  { id: 'pk_concierge', title: '24/7 concierge',       description: 'Chat with your dedicated concierge any time.',  kind: 'concierge', redeemable: false, emoji: '🎩' },
];

const MOCK_OFFERS: PartnerOffer[] = [
  { id: 'of_jumia',   partner: 'Jumia',        title: '15% off electronics', description: 'Black members save 15% on select electronics.', valueKobo: null, category: 'Shopping', expiresAtISO: daysFromNow(20), thumbColor: '#F97316' },
  { id: 'of_uber',    partner: 'Bolt',         title: '₦2,000 ride credit',  description: 'Monthly ride credit for Black members.',       valueKobo: 200_000, category: 'Transport', expiresAtISO: daysFromNow(10), thumbColor: '#16A34A' },
  { id: 'of_nok',     partner: 'Nok Restaurant', title: 'Complimentary dessert', description: 'Free dessert with any main course.',      valueKobo: null, category: 'Dining',   expiresAtISO: daysFromNow(30), thumbColor: '#DC2626' },
  { id: 'of_filmhouse', partner: 'Filmhouse',  title: 'Buy-one-get-one cinema', description: 'BOGO on cinema tickets, Black exclusive.',  valueKobo: 350_000, category: 'Entertainment', expiresAtISO: daysFromNow(14), thumbColor: '#9333EA' },
];

// ── API ─────────────────────────────────────────────────────────────────────
// Backend: GET /api/finance/loyalty/black/me → { success, is_black, member? }.
// There is no separate "eligibility"/"pointsToUnlock" field — the client
// derives a coarse eligibility from is_black (server-authoritative on
// enrolment; MISSING: a member-visible "how close am I" endpoint).
export async function getBlackStatus(): Promise<BlackStatus> {
  if (USE_MOCK) { await delay(); return MOCK_STATUS; }
  const res = await api.get(`${API_BASE}/black/me`);
  const body = res.data as { is_black?: boolean; member?: { since?: string } };
  return {
    isBlack: !!body.is_black,
    eligibility: body.is_black ? 'enrolled' : 'locked',
    lifetimePoints: 0,
    pointsToUnlock: 0,
    memberSinceISO: body.member?.since ?? null,
  };
}

// Backend: GET /api/finance/loyalty/black/perks → { success, perks }.
export async function getBlackPerks(): Promise<BlackPerk[]> {
  if (USE_MOCK) { await delay(); return MOCK_PERKS; }
  const res = await api.get(`${API_BASE}/black/perks`);
  const perks = (res.data as { perks?: Record<string, unknown>[] })?.perks ?? [];
  return perks.map((p) => ({
    id: String(p.id ?? p.code ?? ''),
    title: String(p.title ?? p.name ?? ''),
    description: String(p.description ?? ''),
    kind: (String(p.kind ?? 'event') as BlackPerk['kind']),
    redeemable: p.redeemable !== false,
    emoji: '🎫',
  }));
}

// MISSING BACKEND ENDPOINT: no partner-offers read endpoint is exposed to
// members (partner settlement is admin-only — AdminPartnerSettlement). Falls
// back to the mock offers list.
export async function getPartnerOffers(): Promise<PartnerOffer[]> {
  await delay();
  return MOCK_OFFERS;
}

// MISSING BACKEND ENDPOINT: enrolment onto Black is an ADMIN action
// (BlackHandler.AdminEnroll, RBAC loyalty.black.manage) — a member cannot
// self-upgrade. Kept as a mock-only stub until a self-serve upgrade endpoint
// (or an admin-triggered enrolment flow) ships.
export async function upgradeToBlack(): Promise<{ ok: boolean; memberSinceISO: string }> {
  await delay();
  return { ok: true, memberSinceISO: new Date().toISOString() };
}

// Backend: POST /api/finance/loyalty/black/redeem expects { perk_code,
// context_ref } → { success, redemption }. NOTE: no single-use token is
// returned in the response envelope today (MISSING: a presentable credential
// token) — we surface the redemption id as a stand-in reference.
export async function redeemPerk(input: RedeemPerkInput): Promise<PerkCredential> {
  if (USE_MOCK) {
    await delay();
    const perk = MOCK_PERKS.find((p) => p.id === input.perkId);
    return {
      ok: true,
      token: `PMX-BLK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      perkTitle: perk?.title ?? 'Perk',
      expiresAtISO: daysFromNow(1),
    };
  }
  const perk = MOCK_PERKS.find((p) => p.id === input.perkId);
  const res = await api.post(
    `${API_BASE}/black/redeem`,
    { perk_code: input.perkId, context_ref: `mobile-${Date.now()}` },
    { headers: { 'Idempotency-Key': blackIdempotencyKey() } },
  );
  const redemption = (res.data as { redemption?: { id?: string } })?.redemption;
  return {
    ok: true,
    token: redemption?.id ?? `PMX-BLK-${Date.now()}`,
    perkTitle: perk?.title ?? 'Perk',
    expiresAtISO: daysFromNow(1),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
const KEYS = {
  status: ['loyalty', 'black', 'status'] as const,
  perks:  ['loyalty', 'black', 'perks'] as const,
  offers: ['loyalty', 'black', 'offers'] as const,
};

export const useBlackStatus = () =>
  useQuery({ queryKey: KEYS.status, queryFn: getBlackStatus });

export const useBlackPerks = () =>
  useQuery({ queryKey: KEYS.perks, queryFn: getBlackPerks });

export const usePartnerOffers = () =>
  useQuery({ queryKey: KEYS.offers, queryFn: getPartnerOffers });

export function useUpgradeToBlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => upgradeToBlack(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.status }),
  });
}

export function useRedeemPerk() {
  return useMutation({
    mutationFn: (input: RedeemPerkInput) => redeemPerk(input),
  });
}
