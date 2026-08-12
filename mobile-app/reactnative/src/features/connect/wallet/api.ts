// Paymax Connect — Wallet / Gifting / Tier-KYC / Payout API (PRD §6.4, §7, §10.9).
//
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/wallet/...` on the
// Go backend. EVERY money mutation attaches an `Idempotency-Key` header on the
// live path (generateIdempotencyKey). ALL amounts are kobo (BIGINT minor units).
//
// The server is the source of truth for tier limits, KYC state and ledger
// balances — these mocks only mirror backend-owned config for display.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, CONNECT_API_BASE, TIER_BENEFITS } from '../constants/connect.constants';
import type { ConnectTier, TierStatus } from '../types/connect.types';
import type {
  WalletSummary,
  WalletHistoryPage,
  WalletEntry,
  FundResult,
  GiftProduct,
  GiftRecipient,
  GiftQuote,
  SendGiftInput,
  SendGiftResult,
  GiftTransaction,
  KycStatus,
  TierLimitsRow,
  Tier1Input,
  Tier2Input,
  Tier3Input,
  UpgradeResult,
  PayoutEligibility,
  PayoutRequestInput,
  PayoutRequestResult,
  PayoutRequest,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// On the live path every mutation must carry an Idempotency-Key (iron rule).
//
// Callers on the money path MUST pass a key that is stable across retries of the
// same logical operation (see useIdempotencyKey). Minting one per attempt means a
// retry after a client-side timeout posts a SECOND debit instead of being deduped.
// The fallback generation here exists only for non-money callers where a replay
// is harmless; it is deliberately not the default for wallet mutations.
function idemConfig(idempotencyKey?: string) {
  return { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock state (single in-memory wallet — mutations advance it so the UI feels
// real in mock mode; the live backend owns the canonical ledger).
// ─────────────────────────────────────────────────────────────────────────────

// Current mock user sits at Tier 1, ₦18,500 of a ₦30,000 daily limit remaining.
const MOCK_TIER: TierStatus = {
  tier: 1,
  label: 'Tier 1',
  dailyLimitKobo: 3_000_000,    // ₦30,000
  remainingKobo: 1_850_000,     // ₦18,500 left today
  canSend: true,
  canReceive: true,
  canWithdraw: false,           // withdraw unlocks at Tier 2
  canGoLive: false,
  nextTier: 2,
  nextTierUnlocks: 'Go live, earn & withdraw up to ₦500,000/day',
};

const mockState = {
  balanceKobo: 4_250_000,        // ₦42,500 wallet balance
  tier: { ...MOCK_TIER },
};

function cloneTier(): TierStatus {
  return { ...mockState.tier };
}

// ── Wallet summary / fund / history ──────────────────────────────────────────

export async function getWalletSummary(): Promise<WalletSummary> {
  if (USE_MOCK) {
    await delay(180);
    return { balanceKobo: mockState.balanceKobo, currency: 'NGN', tier: cloneTier() };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/summary`);
  return unwrap<WalletSummary>(res);
}

export async function getTierStatus(): Promise<TierStatus> {
  if (USE_MOCK) {
    await delay(140);
    return cloneTier();
  }
  const res = await api.get(`${CONNECT_API_BASE}/me/tier`);
  return unwrap<TierStatus>(res);
}

const MOCK_HISTORY: WalletEntry[] = [
  {
    id: 'we_1', ref: 'PMX-9F2A11', kind: 'gift_received', direction: 'credit',
    amountKobo: 250_000, balanceAfterKobo: 4_250_000, status: 'completed',
    title: 'Gift from Tobi', counterpartyName: 'Tobi', note: 'Rose 🌹',
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: 'we_2', ref: 'PMX-7C8B40', kind: 'gift_sent', direction: 'debit',
    amountKobo: 99_000, balanceAfterKobo: 4_000_000, status: 'completed',
    title: 'Gift to Amaka', counterpartyName: 'Amaka', note: 'Coffee ☕',
    createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    id: 'we_3', ref: 'PMX-5A1239', kind: 'fund', direction: 'credit',
    amountKobo: 2_000_000, balanceAfterKobo: 4_099_000, status: 'completed',
    title: 'Wallet top-up', note: 'From Paymax wallet',
    createdAt: new Date(Date.now() - 50 * 3600_000).toISOString(),
  },
  {
    id: 'we_4', ref: 'PMX-3D0090', kind: 'boost', direction: 'debit',
    amountKobo: 99_000, balanceAfterKobo: 2_099_000, status: 'completed',
    title: 'Profile Boost', note: '30-minute boost',
    createdAt: new Date(Date.now() - 72 * 3600_000).toISOString(),
  },
  {
    id: 'we_5', ref: 'PMX-1B7755', kind: 'gift_sent', direction: 'debit',
    amountKobo: 150_000, balanceAfterKobo: 2_198_000, status: 'pending',
    title: 'Gift to Zainab', counterpartyName: 'Zainab', note: 'Awaiting confirmation',
    createdAt: new Date(Date.now() - 90 * 3600_000).toISOString(),
  },
];

export async function getWalletHistory(cursor?: string): Promise<WalletHistoryPage> {
  if (USE_MOCK) {
    await delay(260);
    return { entries: MOCK_HISTORY.map((e) => ({ ...e })) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/history`, { params: { cursor } });
  return unwrap<WalletHistoryPage>(res);
}

export async function getWalletEntry(id: string): Promise<WalletEntry> {
  if (USE_MOCK) {
    await delay(160);
    return { ...(MOCK_HISTORY.find((e) => e.id === id) ?? MOCK_HISTORY[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/history/${id}`);
  return unwrap<WalletEntry>(res);
}

// Fund the Connect wallet FROM the Paymax super-app wallet (the only funding
// rail — SAFETY INVARIANT: payments ONLY via Paymax wallet). Idempotent.
export async function fundWallet(amountKobo: number, idempotencyKey?: string): Promise<FundResult> {
  if (USE_MOCK) {
    await delay(600);
    if (amountKobo <= 0) throw new Error('Enter an amount greater than zero.');
    mockState.balanceKobo += amountKobo;
    const entry: WalletEntry = {
      id: `we_${Date.now()}`, ref: `PMX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      kind: 'fund', direction: 'credit', amountKobo, balanceAfterKobo: mockState.balanceKobo,
      status: 'completed', title: 'Wallet top-up', note: 'From Paymax wallet',
      createdAt: new Date().toISOString(),
    };
    MOCK_HISTORY.unshift(entry);
    return { ok: true, entry, balanceKobo: mockState.balanceKobo, tier: cloneTier() };
  }
  const res = await api.post(`${CONNECT_API_BASE}/wallet/fund`, { amountKobo }, idemConfig(idempotencyKey));
  return unwrap<FundResult>(res);
}

// ── Gifting (PRD §6.4) ───────────────────────────────────────────────────────

const MOCK_GIFTS: GiftProduct[] = [
  { id: 'g_rose',     name: 'Rose',     emoji: '🌹', priceKobo: 50_000,  description: 'A classic hello', tierMin: 1 },
  { id: 'g_coffee',   name: 'Coffee',   emoji: '☕', priceKobo: 99_000,  description: 'Break the ice',  tierMin: 1 },
  { id: 'g_heart',    name: 'Heart',    emoji: '❤️', priceKobo: 150_000, description: 'Show you care',  tierMin: 1 },
  { id: 'g_bouquet',  name: 'Bouquet',  emoji: '💐', priceKobo: 300_000, description: 'Make it special', tierMin: 1 },
  { id: 'g_crown',    name: 'Crown',    emoji: '👑', priceKobo: 750_000, description: 'Treat royalty',  tierMin: 2 },
  { id: 'g_diamond',  name: 'Diamond',  emoji: '💎', priceKobo: 2_000_000, description: 'Go all out',   tierMin: 2 },
];

const MOCK_RECIPIENTS: GiftRecipient[] = [
  { id: 'p1', displayName: 'Zainab', handle: '@zainab' },
  { id: 'p2', displayName: 'Tobi', handle: '@tobi' },
  { id: 'p3', displayName: 'Amaka', handle: '@amaka' },
  { id: 'p4', displayName: 'Kelechi', handle: '@kelechi' },
];

export async function getGiftCatalog(): Promise<GiftProduct[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_GIFTS.map((g) => ({ ...g }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/catalog`);
  return unwrap<GiftProduct[]>(res);
}

export async function getGiftProduct(productId: string): Promise<GiftProduct> {
  if (USE_MOCK) {
    await delay(120);
    return { ...(MOCK_GIFTS.find((g) => g.id === productId) ?? MOCK_GIFTS[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/catalog/${productId}`);
  return unwrap<GiftProduct>(res);
}

export async function getGiftRecipients(query?: string): Promise<GiftRecipient[]> {
  if (USE_MOCK) {
    await delay(180);
    const q = (query ?? '').trim().toLowerCase();
    return MOCK_RECIPIENTS.filter((r) =>
      !q || r.displayName.toLowerCase().includes(q) || (r.handle ?? '').toLowerCase().includes(q),
    ).map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/recipients`, { params: { q: query } });
  return unwrap<GiftRecipient[]>(res);
}

// Server computes the quote (fee + remaining-after) fail-closed against the
// tier limit; the client only renders it.
export async function quoteGift(productId: string, recipientId: string): Promise<GiftQuote> {
  if (USE_MOCK) {
    await delay(220);
    const product = MOCK_GIFTS.find((g) => g.id === productId) ?? MOCK_GIFTS[0];
    const recipient = MOCK_RECIPIENTS.find((r) => r.id === recipientId) ?? MOCK_RECIPIENTS[0];
    const feeKobo = 0; // gifting carries no platform fee to the sender in mock
    const totalKobo = product.priceKobo + feeKobo;
    const tier = cloneTier();
    const unlimited = tier.dailyLimitKobo == null || tier.remainingKobo == null;
    const remainingAfterKobo = unlimited ? null : (tier.remainingKobo ?? 0) - totalKobo;
    const withinLimit =
      tier.canSend &&
      product.tierMin <= tier.tier &&
      (unlimited || (remainingAfterKobo ?? 0) >= 0) &&
      mockState.balanceKobo >= totalKobo;
    return { product, recipient, amountKobo: product.priceKobo, feeKobo, totalKobo, tier, remainingAfterKobo, withinLimit };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/quote`, { params: { productId, recipientId } });
  return unwrap<GiftQuote>(res);
}

// Wallet-to-wallet REAL Naira transfer. Idempotent. Server enforces the tier
// limit fail-closed; the client double-checks only for UX.
export async function sendGift(input: SendGiftInput & { idempotencyKey?: string }): Promise<SendGiftResult> {
  const { idempotencyKey, ...body } = input;
  if (USE_MOCK) {
    await delay(700);
    const product = MOCK_GIFTS.find((g) => g.id === input.productId) ?? MOCK_GIFTS[0];
    const recipient = MOCK_RECIPIENTS.find((r) => r.id === input.recipientId) ?? MOCK_RECIPIENTS[0];
    const tier = cloneTier();
    const cost = product.priceKobo;
    if (product.tierMin > tier.tier) {
      throw new Error(`This gift requires Tier ${product.tierMin}. Upgrade to send it.`);
    }
    if (tier.remainingKobo != null && cost > tier.remainingKobo) {
      throw new Error('Daily limit exceeded. Upgrade your tier to gift more today.');
    }
    if (cost > mockState.balanceKobo) {
      throw new Error('Insufficient wallet balance. Fund your wallet to continue.');
    }
    // Advance mock projections.
    mockState.balanceKobo -= cost;
    if (mockState.tier.remainingKobo != null) {
      mockState.tier.remainingKobo = Math.max(0, mockState.tier.remainingKobo - cost);
    }
    const transaction: GiftTransaction = {
      id: `gt_${Date.now()}`, ref: `PMX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      product, recipient, amountKobo: cost, status: 'completed', message: input.message,
      createdAt: new Date().toISOString(),
    };
    MOCK_HISTORY.unshift({
      id: `we_${Date.now()}`, ref: transaction.ref, kind: 'gift_sent', direction: 'debit',
      amountKobo: cost, balanceAfterKobo: mockState.balanceKobo, status: 'completed',
      title: `Gift to ${recipient.displayName}`, counterpartyName: recipient.displayName,
      note: `${product.emoji} ${product.name}`, createdAt: transaction.createdAt,
    });
    return { ok: true, transaction, balanceKobo: mockState.balanceKobo, tier: cloneTier() };
  }
  const res = await api.post(`${CONNECT_API_BASE}/wallet/gifting/send`, body, idemConfig(idempotencyKey));
  return unwrap<SendGiftResult>(res);
}

const MOCK_SENT: GiftTransaction[] = [
  {
    id: 'gt_s1', ref: 'PMX-7C8B40', product: MOCK_GIFTS[1], recipient: MOCK_RECIPIENTS[2],
    amountKobo: 99_000, status: 'completed', message: 'Loved your profile!',
    createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    id: 'gt_s2', ref: 'PMX-1B7755', product: MOCK_GIFTS[2], recipient: MOCK_RECIPIENTS[0],
    amountKobo: 150_000, status: 'pending',
    createdAt: new Date(Date.now() - 90 * 3600_000).toISOString(),
  },
];

const MOCK_RECEIVED: GiftTransaction[] = [
  {
    id: 'gt_r1', ref: 'PMX-9F2A11', product: MOCK_GIFTS[0], recipient: MOCK_RECIPIENTS[0],
    sender: MOCK_RECIPIENTS[1], amountKobo: 50_000, status: 'completed', message: 'Hi 🌹',
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
];

export async function getSentGifts(): Promise<GiftTransaction[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_SENT.map((g) => ({ ...g }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/sent`);
  return unwrap<GiftTransaction[]>(res);
}

export async function getReceivedGifts(): Promise<GiftTransaction[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_RECEIVED.map((g) => ({ ...g }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/received`);
  return unwrap<GiftTransaction[]>(res);
}

export async function getGiftTransaction(id: string): Promise<GiftTransaction> {
  if (USE_MOCK) {
    await delay(160);
    const all = [...MOCK_SENT, ...MOCK_RECEIVED];
    return { ...(all.find((g) => g.id === id) ?? all[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/gifting/transactions/${id}`);
  return unwrap<GiftTransaction>(res);
}

// ── Tier / KYC (PRD §7) ──────────────────────────────────────────────────────

const MOCK_KYC: KycStatus = {
  tier: 1, label: 'Tier 1',
  bvn: 'passed', nin: 'not_started',
  photoId: 'not_started', address: 'not_started',
  liveness: 'not_started', edd: 'not_started',
  reviewState: 'none',
};

export async function getKycStatus(): Promise<KycStatus> {
  if (USE_MOCK) {
    await delay(180);
    return { ...MOCK_KYC };
  }
  const res = await api.get(`${CONNECT_API_BASE}/kyc/status`);
  return unwrap<KycStatus>(res);
}

// Display-only tier ladder with limit deltas. Mirrors backend-owned config
// (TIER_BENEFITS) plus withdraw/single-gift ceilings the upgrade screens show.
const WITHDRAW_DAILY: Record<ConnectTier, number | null> = {
  0: 0, 1: 0, 2: 50_000_000, 3: null,
};
const SINGLE_GIFT_MAX: Record<ConnectTier, number | null> = {
  0: 0, 1: 1_000_000, 2: 10_000_000, 3: null,
};

export async function getTierLimits(): Promise<TierLimitsRow[]> {
  if (USE_MOCK) {
    await delay(140);
    return buildTierLimits();
  }
  const res = await api.get(`${CONNECT_API_BASE}/kyc/limits`);
  return unwrap<TierLimitsRow[]>(res);
}

function buildTierLimits(): TierLimitsRow[] {
  return TIER_BENEFITS.map((b) => ({
    tier: b.tier,
    label: b.label,
    requirement: b.requirement,
    dailyLimitKobo: b.dailyLimitKobo,
    singleGiftMaxKobo: SINGLE_GIFT_MAX[b.tier],
    withdrawDailyKobo: WITHDRAW_DAILY[b.tier],
    privileges: b.privileges,
  }));
}

export async function submitTier1(input: Tier1Input): Promise<UpgradeResult> {
  if (USE_MOCK) {
    await delay(700);
    if (!/^\d{11}$/.test(input.identifier)) {
      throw new Error(`Enter a valid 11-digit ${input.identifierType.toUpperCase()}.`);
    }
    return { ok: true, reviewState: 'passed', targetTier: 1, message: `${input.identifierType.toUpperCase()} linked. Tier 1 active.` };
  }
  const res = await api.post(`${CONNECT_API_BASE}/kyc/tier1`, input, idemConfig());
  return unwrap<UpgradeResult>(res);
}

export async function submitTier2(input: Tier2Input): Promise<UpgradeResult> {
  if (USE_MOCK) {
    await delay(800);
    if (!input.idDocumentUri || !input.proofOfAddressUri) {
      throw new Error('Upload both a photo ID and proof of address.');
    }
    if (!input.addressLine || !input.city || !input.state) {
      throw new Error('Complete your residential address.');
    }
    return { ok: true, reviewState: 'pending', targetTier: 2, message: 'Documents submitted. Review takes up to 24 hours.' };
  }
  const res = await api.post(`${CONNECT_API_BASE}/kyc/tier2`, input, idemConfig());
  return unwrap<UpgradeResult>(res);
}

export async function submitTier3(input: Tier3Input): Promise<UpgradeResult> {
  if (USE_MOCK) {
    await delay(800);
    if (!input.livenessUri) throw new Error('Complete the liveness check.');
    if (!input.sourceOfFunds || !input.occupation) {
      throw new Error('Complete the enhanced due diligence details.');
    }
    return { ok: true, reviewState: 'pending', targetTier: 3, message: 'EDD submitted. Our compliance team will review shortly.' };
  }
  const res = await api.post(`${CONNECT_API_BASE}/kyc/tier3`, input, idemConfig());
  return unwrap<UpgradeResult>(res);
}

// ── Creator payouts (PRD §10.9) — Tier2+ & KYC gated ─────────────────────────

export async function getPayoutEligibility(): Promise<PayoutEligibility> {
  if (USE_MOCK) {
    await delay(200);
    const tier = cloneTier();
    const eligible = tier.canWithdraw && tier.tier >= 2;
    return {
      eligible,
      tier,
      availableKobo: 1_240_000,   // ₦12,400 in creator earnings
      pendingKobo: 320_000,
      minPayoutKobo: 100_000,     // ₦1,000 minimum
      reason: eligible ? undefined : 'Reach Tier 2 (ID + proof of address) to withdraw gift revenue.',
      payoutMethodMasked: eligible ? 'GTBank ••• 4421' : undefined,
    };
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/payouts/eligibility`);
  return unwrap<PayoutEligibility>(res);
}

// Idempotent payout request. Server re-checks Tier2+/KYC gate fail-closed.
export async function requestPayout(input: PayoutRequestInput & { idempotencyKey?: string }): Promise<PayoutRequestResult> {
  const { idempotencyKey, ...body } = input;
  if (USE_MOCK) {
    await delay(700);
    if (input.amountKobo < 100_000) throw new Error('Minimum payout is ₦1,000.');
    if (input.amountKobo > 1_240_000) throw new Error('Amount exceeds your available balance.');
    const feeKobo = 5_000; // flat ₦50 mock fee
    const request: PayoutRequest = {
      id: `po_${Date.now()}`, ref: `PMX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      amountKobo: input.amountKobo, feeKobo, netKobo: input.amountKobo - feeKobo,
      status: 'requested', payoutMethodMasked: 'GTBank ••• 4421',
      createdAt: new Date().toISOString(),
    };
    return { ok: true, request, availableKobo: 1_240_000 - input.amountKobo };
  }
  const res = await api.post(`${CONNECT_API_BASE}/wallet/payouts/request`, body, idemConfig(idempotencyKey));
  return unwrap<PayoutRequestResult>(res);
}

const MOCK_PAYOUTS: PayoutRequest[] = [
  {
    id: 'po_1', ref: 'PMX-PAY771', amountKobo: 500_000, feeKobo: 5_000, netKobo: 495_000,
    status: 'paid', payoutMethodMasked: 'GTBank ••• 4421',
    createdAt: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
  },
  {
    id: 'po_2', ref: 'PMX-PAY802', amountKobo: 300_000, feeKobo: 5_000, netKobo: 295_000,
    status: 'processing', payoutMethodMasked: 'GTBank ••• 4421',
    createdAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
  },
];

export async function getPayoutHistory(): Promise<PayoutRequest[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_PAYOUTS.map((p) => ({ ...p }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/wallet/payouts/history`);
  return unwrap<PayoutRequest[]>(res);
}
