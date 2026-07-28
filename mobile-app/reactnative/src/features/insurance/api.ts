// ── Insurance — API wrapper ──────────────────────────────────────────────────
// Typed data layer the screens code against. Mock-first via USE_MOCK; live path
// hits the frontend-web proxy at `${INSURANCE_API_BASE}/...`. Provider-specific
// JSON never leaks past this layer (PRD §7 — normalised models only).
// IRON RULE: all monetary amounts are integers in minor units (kobo).

import { api } from '@/api/client';
import {
  INSURANCE_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
} from './constants/insurance.constants';
import {
  MOCK_KYC,
  MOCK_POLICIES,
  MOCK_PRODUCTS,
} from './api/insurance.mock';
import type {
  Beneficiary,
  BindResult,
  ConsentPayload,
  CoverSummary,
  InsuranceProduct,
  KycProfile,
  Policy,
  ProductLine,
  Quote,
  QuoteInput,
  RefundState,
} from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));

// In-memory mock store (per session) so bind/cancel/beneficiary mutations persist
// across screens while USE_MOCK is on.
let mockPolicies: Policy[] = [...MOCK_POLICIES];
const mockQuotes = new Map<string, Quote>();

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export async function getProducts(line?: ProductLine): Promise<InsuranceProduct[]> {
  if (USE_MOCK) {
    await delay();
    const all = MOCK_PRODUCTS.filter((p) => p.active);
    return line ? all.filter((p) => p.productLine === line) : all;
  }
  const { data } = await api.get<InsuranceProduct[]>(`${INSURANCE_API_BASE}/products`, {
    params: line ? { line } : undefined,
  });
  return data;
}

export async function getProduct(code: string): Promise<InsuranceProduct> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_PRODUCTS.find((p) => p.code === code);
    if (!found) throw new Error('Product not found');
    return found;
  }
  // GAP: Go only exposes GET /products?line= (catalog/handler.go ListProducts) —
  // there is no GET /products/:code. Fetch the filtered list and find the code
  // client-side rather than calling a route that doesn't exist.
  const { data } = await api.get<InsuranceProduct[]>(`${INSURANCE_API_BASE}/products`);
  const found = data.find((p) => p.code === code);
  if (!found) throw new Error('Product not found');
  return found;
}

// ── KYC profile (prefill) ─────────────────────────────────────────────────────
// GAP: no GET /kyc-profile on the Go insurance surface (backend/internal/insurance
// has no such handler; KYC lives in finance/kyc and isn't exposed to this module's
// member group). Until a backend endpoint/proxy exists this stays mock-only in
// live mode too (throwing would break the quote-prefill screen); report upstream.
export async function getKycProfile(): Promise<KycProfile> {
  // Always mock — see GAP note above; no live source exists yet.
  await delay(180);
  return MOCK_KYC;
}

// ── Cover summary (Protection hub) ────────────────────────────────────────────
// GAP: no GET /cover-summary on the Go side — derive it client-side from the real
// live GET /policies endpoint (same aggregation the mock does) instead of calling
// a route that 404s.
export async function getCoverSummary(): Promise<CoverSummary> {
  if (USE_MOCK) {
    await delay();
    const active = mockPolicies.filter((p) => p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE');
    return {
      activePolicies: active.length,
      totalSumInsuredKobo: active.reduce((s, p) => s + p.sumInsuredKobo, 0),
      monthlyPremiumKobo: active
        .filter((p) => p.premiumCadence === 'monthly')
        .reduce((s, p) => s + p.premiumKobo, 0),
      renewalsDue: mockPolicies.filter((p) => p.state === 'RENEWAL_DUE').length,
    };
  }
  const policies = await getPolicies();
  const active = policies.filter((p) => p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE');
  return {
    activePolicies: active.length,
    totalSumInsuredKobo: active.reduce((s, p) => s + p.sumInsuredKobo, 0),
    monthlyPremiumKobo: active
      .filter((p) => p.premiumCadence === 'monthly')
      .reduce((s, p) => s + p.premiumKobo, 0),
    renewalsDue: policies.filter((p) => p.state === 'RENEWAL_DUE').length,
  };
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export async function createQuote(input: QuoteInput): Promise<Quote> {
  if (USE_MOCK) {
    await delay(520);
    const product = MOCK_PRODUCTS.find((p) => p.code === input.productCode);
    if (!product) throw new Error('Product not found');

    // Naive illustrative pricing: scale flat premium by declared value / tier.
    let premiumKobo = product.fromPremiumKobo;
    let sumInsuredKobo = product.sumInsuredRules.min;
    const declared =
      Number(input.inputs.deviceValue ?? input.inputs.vehicleValue ?? input.inputs.declaredValue ?? input.inputs.assetValue ?? input.inputs.coverAmount ?? 0) * 100;
    if (product.sumInsuredRules.basis === 'declared_value' && declared > 0) {
      sumInsuredKobo = Math.min(Math.max(declared, product.sumInsuredRules.min), product.sumInsuredRules.max);
      premiumKobo = Math.max(product.fromPremiumKobo, Math.round(sumInsuredKobo * 0.03));
    }
    if (input.inputs.plan === 'silver') { premiumKobo = Math.round(premiumKobo * 1.8); sumInsuredKobo = 1_000_000_00; }
    if (input.inputs.plan === 'gold')   { premiumKobo = Math.round(premiumKobo * 2.6); sumInsuredKobo = 2_000_000_00; }
    const dependents = Number(input.inputs.dependents ?? 0);
    if (dependents > 0) premiumKobo += dependents * 400_00;

    const quote: Quote = {
      id: uid('qte'),
      productCode: product.code,
      productName: product.displayName,
      provider: product.provider,
      disclosure: product.disclosure,
      premiumKobo,
      premiumCadence: product.premiumCadence,
      sumInsuredKobo,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      inputs: input.inputs,
      benefits: product.benefits,
      exclusions: product.exclusions,
      termsRef: `terms/${product.code}.pdf`,
    };
    mockQuotes.set(quote.id, quote);
    return quote;
  }
  const { data } = await api.post<Quote>(`${INSURANCE_API_BASE}/quotes`, input);
  return data;
}

export async function getQuote(id: string): Promise<Quote> {
  if (USE_MOCK) {
    await delay(160);
    const q = mockQuotes.get(id);
    if (!q) throw new Error('Quote expired or not found');
    return q;
  }
  const { data } = await api.get<Quote>(`${INSURANCE_API_BASE}/quotes/${id}`);
  return data;
}

// ── NDPA consent (PRD §18) ────────────────────────────────────────────────────
export async function recordConsent(payload: ConsentPayload): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(160);
    return { ok: true };
  }
  // Go route is singular POST /api/finance/insurance/consent (see consent/handler.go
  // Grant: `product_code` + optional `scope`); body mapped to the Go shape here.
  // (Go's consent record is scoped by product_code + a version constant server-side —
  // payload.version/fields/acceptedAt are client-side display metadata, not sent.)
  await api.post(`${INSURANCE_API_BASE}/consent`, { product_code: payload.productCode });
  return { ok: true };
}

// ── Bind (debit→bind saga; PRD §11) ───────────────────────────────────────────
// The wallet debit is handled by the shared payments controller (usePurchasePayment).
// `bindPolicy` is the module's "charge" — it binds with the provider AFTER funds
// are guaranteed. On bind failure the premium is auto-reversed to wallet (the
// single most important invariant, PRD §10.1).
export async function bindPolicy(args: {
  quoteId: string;
  idempotencyKey: string;
}): Promise<BindResult> {
  if (USE_MOCK) {
    await delay(900);
    const quote = mockQuotes.get(args.quoteId);
    if (!quote) {
      return {
        ok: false,
        errorCode: 'PROVIDER_TIMEOUT',
        errorMessage: 'Quote expired before binding. Your wallet was not charged.',
      };
    }
    // Simulate a rare underwriter rejection to exercise the auto-refund path:
    // bind fails when declared value is exactly the sentinel 13_000 (demo hook).
    if (quote.inputs.declaredValue === '13000' || quote.inputs.deviceValue === '13000') {
      return {
        ok: false,
        errorCode: 'BIND_REJECTED_BY_UNDERWRITER',
        errorMessage: 'The underwriter could not bind this policy. Your premium has been refunded to your wallet.',
        autoRefundKobo: quote.premiumKobo,
      };
    }
    const product = MOCK_PRODUCTS.find((p) => p.code === quote.productCode);
    const now = new Date();
    const expires = new Date(now);
    if (quote.premiumCadence === 'monthly') expires.setMonth(expires.getMonth() + 1);
    else expires.setFullYear(expires.getFullYear() + 1);

    const policy: Policy = {
      id: uid('pol'),
      productCode: quote.productCode,
      productName: quote.productName,
      productLine: product?.productLine ?? 'GENERAL',
      provider: quote.provider,
      disclosure: quote.disclosure,
      state: 'ACTIVE',
      bindingMode: product?.bindingMode ?? 'VOLUNTARY',
      sumInsuredKobo: quote.sumInsuredKobo,
      premiumKobo: quote.premiumKobo,
      premiumCadence: quote.premiumCadence,
      currency: 'NGN',
      effectiveAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      certificateRef: `cert/${uid('cert')}-signed.pdf`,
      beneficiaries: [],
      icon: product?.icon ?? 'ShieldCheck',
      refundState: 'NONE',
      createdAt: now.toISOString(),
    };
    mockPolicies = [policy, ...mockPolicies];
    return { ok: true, policy };
  }

  // Live: Idempotency-Key REQUIRED on bind (PRD §12.1).
  const { data } = await api.post<BindResult>(
    `${INSURANCE_API_BASE}/policies`,
    { quoteId: args.quoteId },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

// ── Policy wallet ─────────────────────────────────────────────────────────────
export async function getPolicies(): Promise<Policy[]> {
  if (USE_MOCK) {
    await delay();
    return mockPolicies;
  }
  const { data } = await api.get<Policy[]>(`${INSURANCE_API_BASE}/policies`);
  return data;
}

export async function getPolicy(id: string): Promise<Policy> {
  if (USE_MOCK) {
    await delay(200);
    const found = mockPolicies.find((p) => p.id === id);
    if (!found) throw new Error('Policy not found');
    return found;
  }
  const { data } = await api.get<Policy>(`${INSURANCE_API_BASE}/policies/${id}`);
  return data;
}

export async function getCertificateUrl(id: string): Promise<{ url: string; expiresAt: string }> {
  if (USE_MOCK) {
    await delay(260);
    const found = mockPolicies.find((p) => p.id === id);
    return {
      url: found?.certificateRef
        ? `https://docs.paymax.example/${found.certificateRef}?sig=mock`
        : '',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
  const { data } = await api.get<{ url: string; expiresAt: string }>(
    `${INSURANCE_API_BASE}/policies/${id}/certificate`,
  );
  return data;
}

// ── Beneficiaries ─────────────────────────────────────────────────────────────
export async function saveBeneficiaries(
  policyId: string,
  beneficiaries: Beneficiary[],
): Promise<Policy> {
  if (USE_MOCK) {
    await delay(300);
    mockPolicies = mockPolicies.map((p) =>
      p.id === policyId ? { ...p, beneficiaries } : p,
    );
    const updated = mockPolicies.find((p) => p.id === policyId);
    if (!updated) throw new Error('Policy not found');
    return updated;
  }
  const { data } = await api.post<Policy>(
    `${INSURANCE_API_BASE}/policies/${policyId}/beneficiaries`,
    { beneficiaries },
  );
  return data;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
// GAP: policy/handler.go registers Cancel but no Renew handler — Go has no
// POST /policies/:id/renew yet. Mobile call below is written correctly for when
// it lands (Idempotency-Key attached); until then this 404s in live mode.
export async function renewPolicy(args: {
  policyId: string;
  idempotencyKey: string;
}): Promise<Policy> {
  if (USE_MOCK) {
    await delay(700);
    const now = new Date();
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);
    mockPolicies = mockPolicies.map((p) =>
      p.id === args.policyId
        ? { ...p, state: 'ACTIVE', effectiveAt: now.toISOString(), expiresAt: expires.toISOString(), renewalDueAt: undefined }
        : p,
    );
    const updated = mockPolicies.find((p) => p.id === args.policyId);
    if (!updated) throw new Error('Policy not found');
    return updated;
  }
  const { data } = await api.post<Policy>(
    `${INSURANCE_API_BASE}/policies/${args.policyId}/renew`,
    {},
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

export async function cancelPolicy(args: {
  policyId: string;
  reason: string;
}): Promise<Policy> {
  if (USE_MOCK) {
    await delay(600);
    mockPolicies = mockPolicies.map((p) =>
      p.id === args.policyId
        ? { ...p, state: 'CANCELLED', refundState: 'PENDING', refundKobo: Math.round(p.premiumKobo * 0.5) }
        : p,
    );
    const updated = mockPolicies.find((p) => p.id === args.policyId);
    if (!updated) throw new Error('Policy not found');
    return updated;
  }
  const { data } = await api.post<Policy>(
    `${INSURANCE_API_BASE}/policies/${args.policyId}/cancel`,
    { reason: args.reason },
  );
  return data;
}

// GAP: no GET /policies/:id/refund-status on the Go side (refund state currently
// only surfaces embedded in the Policy record itself — see `refundState` /
// `refundKobo` on Policy, which getPolicy() already returns live). This helper
// still 404s in live mode until a dedicated endpoint exists; prefer reading
// policy.refundState directly where possible.
export async function getRefundStatus(
  policyId: string,
): Promise<{ state: RefundState; amountKobo: number; updatedAt: string }> {
  if (USE_MOCK) {
    await delay(220);
    const found = mockPolicies.find((p) => p.id === policyId);
    return {
      state: found?.refundState ?? 'NONE',
      amountKobo: found?.refundKobo ?? 0,
      updatedAt: new Date().toISOString(),
    };
  }
  const { data } = await api.get<{ state: RefundState; amountKobo: number; updatedAt: string }>(
    `${INSURANCE_API_BASE}/policies/${policyId}/refund-status`,
  );
  return data;
}
