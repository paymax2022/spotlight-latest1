// ── Insurance — Agent data layer (IM2) ───────────────────────────────────────
// Assisted-sales for the informal market (PRD §14.6 / §15.2 / §16). The agent
// looks up a CUSTOMER, recommends a product, runs an assisted quote, binds, and
// captures cash → agent float → customer wallet. CRITICAL: the policy attaches to
// the CUSTOMER identity, never the agent's. Agent sees only their own book + own
// commission (object-level authZ, PRD §16). ADDITIVE to IM1. Money is kobo.
//
// GAP (whole file): no `/agent/*` routes exist anywhere on the Go insurance
// surface (grepped backend/internal/insurance/** and backend/internal/app/
// insurance*_routes.go — zero matches for "agent"). Every live-mode call here
// (customers, book, commission, cash-capture, bind) 404s today — customer
// lookup + cash-to-wallet capture are especially sensitive (money movement to a
// THIRD PARTY's wallet, not the caller's) and must not go live without backend
// review + the fail-closed tier/KYC checks CLAUDE.md requires. Report upstream.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  INSURANCE_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
} from './constants/insurance.constants';
import { getProducts, createQuote } from './api';
import type { InsuranceProduct, Policy, Provider, Quote } from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Customer (assisted-sale subject) ──────────────────────────────────────────
export interface AgentCustomer {
  id: string;
  fullName: string;
  phone: string;
  walletKobo: number;
  kycTier: 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';
  location: string;
}

/** A policy in the agent's book — attached to a CUSTOMER, sold by this agent. */
export interface AgentBookEntry {
  policyId: string;
  customerId: string;
  customerName: string;
  productName: string;
  provider: Provider;
  state: Policy['state'];
  premiumKobo: number;
  sumInsuredKobo: number;
  commissionKobo: number;
  boundAt: string;
}

export interface AgentCommissionSummary {
  totalEarnedKobo: number;
  pendingKobo: number;
  paidKobo: number;
  policiesSold: number;
  thisMonthKobo: number;
  entries: { policyId: string; productName: string; commissionKobo: number; status: 'pending' | 'paid'; at: string }[];
}

// ── Mock store ───────────────────────────────────────────────────────────────
const MOCK_CUSTOMERS: AgentCustomer[] = [
  { id: 'cus-001', fullName: 'Chinedu Eze', phone: '+2348021112233', walletKobo: 12_500_00, kycTier: 'TIER_1', location: 'Onitsha, Anambra' },
  { id: 'cus-002', fullName: 'Fatima Bello', phone: '+2347039998877', walletKobo: 3_200_00, kycTier: 'TIER_1', location: 'Kano, Kano' },
  { id: 'cus-003', fullName: 'Tunde Bakare', phone: '+2348144455566', walletKobo: 0, kycTier: 'TIER_0', location: 'Ibadan, Oyo' },
  { id: 'cus-004', fullName: 'Ngozi Umeh', phone: '+2349011224455', walletKobo: 48_000_00, kycTier: 'TIER_2', location: 'Enugu, Enugu' },
];

let mockBook: AgentBookEntry[] = [
  {
    policyId: 'pol-agent-001', customerId: 'cus-004', customerName: 'Ngozi Umeh',
    productName: 'MicroHealth Essential', provider: 'MYCOVER', state: 'ACTIVE',
    premiumKobo: 1_200_00, sumInsuredKobo: 1_000_000_00, commissionKobo: 180_00,
    boundAt: new Date(Date.now() - 9 * 86400000).toISOString(),
  },
  {
    policyId: 'pol-agent-002', customerId: 'cus-001', customerName: 'Chinedu Eze',
    productName: 'Personal Accident Shield', provider: 'MYCOVER', state: 'ACTIVE',
    premiumKobo: 500_00, sumInsuredKobo: 2_000_000_00, commissionKobo: 75_00,
    boundAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

const COMMISSION_RATE = 0.15; // illustrative share-of-premium

export async function lookupCustomers(query: string): Promise<AgentCustomer[]> {
  if (USE_MOCK) {
    await delay(300);
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_CUSTOMERS;
    return MOCK_CUSTOMERS.filter(
      (c) => c.fullName.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }
  const { data } = await api.get<AgentCustomer[]>(`${INSURANCE_API_BASE}/agent/customers`, {
    params: { q: query },
  });
  return data;
}

export async function getCustomer(id: string): Promise<AgentCustomer> {
  if (USE_MOCK) {
    await delay(180);
    const found = MOCK_CUSTOMERS.find((c) => c.id === id);
    if (!found) throw new Error('Customer not found');
    return found;
  }
  const { data } = await api.get<AgentCustomer>(`${INSURANCE_API_BASE}/agent/customers/${id}`);
  return data;
}

/** Recommended products for a customer (reuses IM1 catalog). */
export async function getRecommendedProducts(): Promise<InsuranceProduct[]> {
  const all = await getProducts();
  // Recommend the informal-market staples first.
  const priority = ['HEALTH', 'PERSONAL_ACCIDENT', 'DEVICE'];
  return [...all].sort(
    (a, b) => priority.indexOf(a.productLine) - priority.indexOf(b.productLine),
  );
}

/** Assisted quote — same engine as voluntary buy, on the customer's behalf. */
export async function createAssistedQuote(args: {
  customerId: string;
  productCode: string;
  inputs: Record<string, string>;
}): Promise<Quote> {
  // Reuse IM1's quote engine (provider-agnostic, normalised).
  return createQuote({ productCode: args.productCode, inputs: args.inputs });
}

// ── Cash-to-wallet capture (cash → agent float → CUSTOMER wallet) ─────────────
export async function captureCashToWallet(args: {
  customerId: string;
  amountKobo: number;
  idempotencyKey: string;
}): Promise<{ ok: true; customer: AgentCustomer }> {
  if (USE_MOCK) {
    await delay(700);
    const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === args.customerId);
    if (idx === -1) throw new Error('Customer not found');
    MOCK_CUSTOMERS[idx] = { ...MOCK_CUSTOMERS[idx], walletKobo: MOCK_CUSTOMERS[idx].walletKobo + args.amountKobo };
    return { ok: true, customer: MOCK_CUSTOMERS[idx] };
  }
  const { data } = await api.post<{ ok: true; customer: AgentCustomer }>(
    `${INSURANCE_API_BASE}/agent/cash-capture`,
    { customerId: args.customerId, amountKobo: args.amountKobo },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

// ── Assisted bind — policy attaches to the CUSTOMER (PRD §14.6) ────────────────
export interface AssistedBindResult {
  ok: boolean;
  bookEntry?: AgentBookEntry;
  errorCode?: 'INSUFFICIENT_FUNDS' | 'BIND_REJECTED_BY_UNDERWRITER' | 'PROVIDER_UNAVAILABLE';
  errorMessage?: string;
}

export async function assistedBind(args: {
  customerId: string;
  quoteId: string;
  idempotencyKey: string;
}): Promise<AssistedBindResult> {
  if (USE_MOCK) {
    await delay(900);
    const customer = MOCK_CUSTOMERS.find((c) => c.id === args.customerId);
    if (!customer) return { ok: false, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'Customer not found.' };
    // We don't have the quote object here in mock; synthesize a plausible entry.
    const premiumKobo = 1_200_00;
    if (customer.walletKobo < premiumKobo) {
      return { ok: false, errorCode: 'INSUFFICIENT_FUNDS', errorMessage: 'Customer wallet has insufficient funds. Capture cash first.' };
    }
    const idx = MOCK_CUSTOMERS.findIndex((c) => c.id === args.customerId);
    MOCK_CUSTOMERS[idx] = { ...customer, walletKobo: customer.walletKobo - premiumKobo };
    const entry: AgentBookEntry = {
      policyId: uid('pol-agent'),
      customerId: customer.id,
      customerName: customer.fullName,
      productName: 'MicroHealth Essential',
      provider: 'MYCOVER',
      state: 'ACTIVE',
      premiumKobo,
      sumInsuredKobo: 1_000_000_00,
      commissionKobo: Math.round(premiumKobo * COMMISSION_RATE),
      boundAt: new Date().toISOString(),
    };
    mockBook = [entry, ...mockBook];
    return { ok: true, bookEntry: entry };
  }
  const { data } = await api.post<AssistedBindResult>(
    `${INSURANCE_API_BASE}/agent/bind`,
    { customerId: args.customerId, quoteId: args.quoteId },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return data;
}

export async function getAgentBook(): Promise<AgentBookEntry[]> {
  if (USE_MOCK) {
    await delay();
    return [...mockBook].sort((a, b) => +new Date(b.boundAt) - +new Date(a.boundAt));
  }
  const { data } = await api.get<AgentBookEntry[]>(`${INSURANCE_API_BASE}/agent/book`);
  return data;
}

export async function getAgentCommission(): Promise<AgentCommissionSummary> {
  if (USE_MOCK) {
    await delay();
    const now = new Date();
    const entries = mockBook.map((b, i) => ({
      policyId: b.policyId,
      productName: b.productName,
      commissionKobo: b.commissionKobo,
      status: (i % 2 === 0 ? 'paid' : 'pending') as 'paid' | 'pending',
      at: b.boundAt,
    }));
    const total = entries.reduce((s, e) => s + e.commissionKobo, 0);
    const paid = entries.filter((e) => e.status === 'paid').reduce((s, e) => s + e.commissionKobo, 0);
    const thisMonth = entries
      .filter((e) => new Date(e.at).getMonth() === now.getMonth())
      .reduce((s, e) => s + e.commissionKobo, 0);
    return {
      totalEarnedKobo: total,
      paidKobo: paid,
      pendingKobo: total - paid,
      policiesSold: mockBook.length,
      thisMonthKobo: thisMonth,
      entries,
    };
  }
  const { data } = await api.get<AgentCommissionSummary>(`${INSURANCE_API_BASE}/agent/commission`);
  return data;
}

// ── React Query hooks ─────────────────────────────────────────────────────────
const KEY = 'insurance-agent';

export function useCustomerLookup(query: string) {
  return useQuery({
    queryKey: [KEY, 'customers', query],
    queryFn: () => lookupCustomers(query),
    staleTime: 15_000,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: [KEY, 'customer', id],
    queryFn: () => getCustomer(id),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useRecommendedProducts() {
  return useQuery({
    queryKey: [KEY, 'recommended'],
    queryFn: getRecommendedProducts,
    staleTime: 5 * 60_000,
  });
}

export function useCreateAssistedQuote() {
  return useMutation({
    mutationFn: (args: { customerId: string; productCode: string; inputs: Record<string, string> }) =>
      createAssistedQuote(args),
  });
}

export function useCaptureCashToWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; amountKobo: number; idempotencyKey: string }) =>
      captureCashToWallet(args),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, 'customer', vars.customerId] });
    },
  });
}

export function useAssistedBind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; quoteId: string; idempotencyKey: string }) =>
      assistedBind(args),
    onSuccess: (res, vars) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: [KEY, 'book'] });
        qc.invalidateQueries({ queryKey: [KEY, 'commission'] });
        qc.invalidateQueries({ queryKey: [KEY, 'customer', vars.customerId] });
      }
    },
  });
}

export function useAgentBook() {
  return useQuery({ queryKey: [KEY, 'book'], queryFn: getAgentBook, staleTime: 30_000 });
}

export function useAgentCommission() {
  return useQuery({ queryKey: [KEY, 'commission'], queryFn: getAgentCommission, staleTime: 30_000 });
}
