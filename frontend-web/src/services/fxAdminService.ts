// ── Admin — FX Orchestration service ─────────────────────────────────────────
// Mock-backed (no backend endpoints yet). Mirrors crowdfundingAdminService /
// fintechService shape: flip USE_MOCK to false and the fetch branches hit
// /api/fx/admin/... All money is integer minor units.

import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  FxOverview, FxTxSummary, FxTxDetail, FxTxFilter,
  RoutingWeights, RouteSimResult, ProviderConfig, FloatBucket, RebalanceEvent,
  SpreadRule, ReconRun, ReconBreak, Provider,
  AdminCustomer, CustomerDetail, CustomerVerification,
  ScreeningAlert, CaseStatus,
  WebhookEndpoint, WebhookDelivery, ApiKey,
  FxAnalytics,
  VirtualAccountReg, AdminCollectionEvent, BeneficiaryValidationIssue,
  IssuedCard, SuspiciousCardActivity, IssuedCardStatus,
  FxSettingsCatalogue,
} from '@/types/fxAdmin';

// Mock by default; flip with NEXT_PUBLIC_FX_ADMIN_USE_MOCK=false once the admin
// control-plane endpoints are live on the Go backend.
const USE_MOCK = (process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/fx/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ─── Mock datasets ────────────────────────────────────────────────────────────

const OVERVIEW: FxOverview = {
  gmvUsdCents: 4_280_500_00,
  marginUsdCents: 48_900_00,
  txCount24h: 1_284,
  successRate: 98.4,
  failureRate: 1.6,
  reconBreaks: 3,
  openIncidents: 1,
  floatHealthPct: 86,
  providerMix: [
    { provider: 'eversend', share: 58, volumeUsdCents: 2_482_690_00 },
    { provider: 'maplerad', share: 42, volumeUsdCents: 1_797_810_00 },
  ],
  topCorridors: [
    { corridor: 'USD-NGN', volumeUsdCents: 1_920_000_00, marginUsdCents: 22_400_00, successRate: 98.9 },
    { corridor: 'USD-XAF', volumeUsdCents: 640_000_00, marginUsdCents: 9_100_00, successRate: 97.2 },
    { corridor: 'EUR-NGN', volumeUsdCents: 580_000_00, marginUsdCents: 7_300_00, successRate: 99.1 },
    { corridor: 'USD-GHS', volumeUsdCents: 410_000_00, marginUsdCents: 5_200_00, successRate: 96.4 },
    { corridor: 'GBP-NGN', volumeUsdCents: 320_000_00, marginUsdCents: 4_900_00, successRate: 98.0 },
  ],
  breakers: [
    { provider: 'eversend', state: 'closed' },
    { provider: 'maplerad', state: 'half_open' },
  ],
};

const TXNS: FxTxDetail[] = [
  {
    id: 'tx_90021', reference: 'PMX-CV-90021', type: 'conversion', status: 'successful',
    customer: 'Acme Ltd', customerEmail: 'ops@acme.example', provider: 'eversend', corridor: 'USD-NGN', rail: 'wallet',
    source: { amountMinor: 1_000_00, currency: 'USD' }, destination: { amountMinor: 158_143_000, currency: 'NGN' },
    quotedRate: 1598.2, executedRate: 1581.43, providerRef: 'evs_8841aa', narration: null,
    createdAt: '2026-06-19T10:21:00Z',
    fees: [{ type: 'provider_fee', amount: { amountMinor: 25, currency: 'USD' } }, { type: 'paymax_spread', amount: { amountMinor: 10_50, currency: 'USD' } }],
    statusHistory: [{ status: 'pending', at: '2026-06-19T10:21:00Z' }, { status: 'settled', at: '2026-06-19T10:21:04Z' }],
    scoring: [
      { provider: 'eversend', chosen: true, score: 0.91, cost: 0.95, coverage: 1, liquidity: 0.88, reliability: 0.92 },
      { provider: 'maplerad', chosen: false, score: 0.86, cost: 0.89, coverage: 1, liquidity: 0.8, reliability: 0.9 },
    ],
  },
  {
    id: 'tx_77810', reference: 'PMX-TR-77810', type: 'transfer', status: 'successful',
    customer: 'Jane Doe', customerEmail: 'jane@example.com', provider: 'maplerad', corridor: 'USD-XAF', rail: 'mobile_money',
    source: { amountMinor: 100_00, currency: 'USD' }, destination: { amountMinor: 60_250_00, currency: 'XAF' },
    quotedRate: 602.5, executedRate: 600.1, providerRef: 'mpl_5521cd', narration: 'Vendor settlement',
    createdAt: '2026-06-19T09:02:00Z',
    fees: [{ type: 'provider_fee', amount: { amountMinor: 25, currency: 'USD' } }, { type: 'paymax_spread', amount: { amountMinor: 1_05, currency: 'USD' } }],
    statusHistory: [{ status: 'queued', at: '2026-06-19T09:02:00Z' }, { status: 'processing', at: '2026-06-19T09:02:12Z' }, { status: 'paid', at: '2026-06-19T09:02:40Z' }],
    scoring: [
      { provider: 'maplerad', chosen: true, score: 0.93, cost: 0.9, coverage: 1, liquidity: 0.95, reliability: 0.94 },
      { provider: 'eversend', chosen: false, score: 0.79, cost: 0.82, coverage: 0.7, liquidity: 0.85, reliability: 0.9 },
    ],
  },
  {
    id: 'tx_77744', reference: 'PMX-TR-77744', type: 'transfer', status: 'failed',
    customer: 'Kwame M.', customerEmail: 'kwame@example.com', provider: 'eversend', corridor: 'USD-GHS', rail: 'mobile_money',
    source: { amountMinor: 50_00, currency: 'USD' }, destination: { amountMinor: 740_00, currency: 'GHS' },
    quotedRate: 14.8, executedRate: null, providerRef: 'evs_fail_8830', narration: 'Refund',
    createdAt: '2026-06-19T07:40:00Z',
    fees: [{ type: 'paymax_spread', amount: { amountMinor: 52, currency: 'USD' } }],
    statusHistory: [{ status: 'queued', at: '2026-06-19T07:40:00Z' }, { status: 'failed', at: '2026-06-19T07:40:30Z' }],
    scoring: [
      { provider: 'eversend', chosen: true, score: 0.74, cost: 0.8, coverage: 0.9, liquidity: 0.6, reliability: 0.7 },
      { provider: 'maplerad', chosen: false, score: 0.72, cost: 0.75, coverage: 0.9, liquidity: 0.7, reliability: 0.78 },
    ],
    failureReason: 'Beneficiary wallet could not be validated by the provider.',
  },
  {
    id: 'tx_44120', reference: 'PMX-COL-44120', type: 'collection', status: 'successful',
    customer: 'Acme Ltd', customerEmail: 'ops@acme.example', provider: 'eversend', corridor: 'USD-USD', rail: 'iban',
    source: { amountMinor: 1_200_00, currency: 'USD' }, destination: { amountMinor: 1_200_00, currency: 'USD' },
    quotedRate: null, executedRate: null, providerRef: 'evs_col_2031', narration: 'INV-2031',
    createdAt: '2026-06-19T06:10:00Z',
    fees: [],
    statusHistory: [{ status: 'received', at: '2026-06-19T06:10:00Z' }],
    scoring: [{ provider: 'eversend', chosen: true, score: 1, cost: 1, coverage: 1, liquidity: 1, reliability: 1 }],
  },
  {
    id: 'tx_90108', reference: 'PMX-CV-90108', type: 'conversion', status: 'processing',
    customer: 'Tunde B.', customerEmail: 'tunde@example.com', provider: 'maplerad', corridor: 'NGN-USD', rail: 'wallet',
    source: { amountMinor: 1_600_000_00, currency: 'NGN' }, destination: { amountMinor: 996_00, currency: 'USD' },
    quotedRate: 0.000626, executedRate: null, providerRef: 'mpl_inflight_2', narration: null,
    createdAt: '2026-06-19T10:58:00Z',
    fees: [{ type: 'paymax_spread', amount: { amountMinor: 16_800_00, currency: 'NGN' } }],
    statusHistory: [{ status: 'pending', at: '2026-06-19T10:58:00Z' }],
    scoring: [
      { provider: 'maplerad', chosen: true, score: 0.88, cost: 0.9, coverage: 1, liquidity: 0.82, reliability: 0.9 },
      { provider: 'eversend', chosen: false, score: 0.87, cost: 0.92, coverage: 1, liquidity: 0.8, reliability: 0.88 },
    ],
  },
];

let WEIGHTS: RoutingWeights[] = [
  { corridor: 'USD-NGN', tier: 'All tiers', wCost: 0.45, wCover: 0.2, wLiq: 0.2, wRel: 0.15, enabled: { eversend: true, maplerad: true }, bias: 'auto' },
  { corridor: 'USD-XAF', tier: 'All tiers', wCost: 0.3, wCover: 0.35, wLiq: 0.2, wRel: 0.15, enabled: { eversend: false, maplerad: true }, bias: 'maplerad' },
  { corridor: 'EUR-NGN', tier: 'All tiers', wCost: 0.5, wCover: 0.2, wLiq: 0.2, wRel: 0.1, enabled: { eversend: true, maplerad: true }, bias: 'eversend' },
];

let PROVIDERS: ProviderConfig[] = [
  {
    provider: 'eversend', displayName: 'Eversend', enabled: true,
    corridors: ['USD-NGN', 'EUR-NGN', 'USD-GHS', 'USD-KES'], rails: ['bank_transfer', 'mobile_money', 'iban', 'stablecoin'],
    exposureLimitUsdCents: 5_000_000_00, exposureUsedUsdCents: 2_482_690_00, latencyMsP95: 540, successRate: 98.7,
    breaker: 'closed', adapterStatus: 'live',
  },
  {
    provider: 'maplerad', displayName: 'Maplerad', enabled: true,
    corridors: ['USD-NGN', 'USD-XAF', 'NGN-USD'], rails: ['bank_transfer', 'mobile_money', 'iban', 'stablecoin'],
    exposureLimitUsdCents: 4_000_000_00, exposureUsedUsdCents: 1_797_810_00, latencyMsP95: 690, successRate: 97.9,
    breaker: 'half_open', adapterStatus: 'live',
  },
];

let FLOATS: FloatBucket[] = [
  { provider: 'eversend', currency: 'USD', balanceMinor: 820_000_00, lowWaterMinor: 200_000_00, highWaterMinor: 1_000_000_00, status: 'healthy' },
  { provider: 'eversend', currency: 'NGN', balanceMinor: 180_000_000_00, lowWaterMinor: 250_000_000_00, highWaterMinor: 900_000_000_00, status: 'low' },
  { provider: 'maplerad', currency: 'USD', balanceMinor: 96_000_00, lowWaterMinor: 150_000_00, highWaterMinor: 800_000_00, status: 'critical' },
  { provider: 'maplerad', currency: 'XAF', balanceMinor: 420_000_000_00, lowWaterMinor: 100_000_000_00, highWaterMinor: 500_000_000_00, status: 'healthy' },
];

const REBALANCES: RebalanceEvent[] = [
  { id: 'rb1', from: 'eversend', to: 'maplerad', currency: 'USD', amountMinor: 200_000_00, path: 'stablecoin', status: 'completed', createdAt: '2026-06-19T05:00:00Z' },
  { id: 'rb2', from: 'maplerad', to: 'eversend', currency: 'NGN', amountMinor: 80_000_000_00, path: 'fiat', status: 'pending', createdAt: '2026-06-19T09:30:00Z' },
];

let SPREADS: SpreadRule[] = [
  { id: 'sp1', corridor: 'USD-NGN', tier: 'Retail', bps: 120, fixedMinor: 0, minBps: 80, maxBps: 200, version: 4, updatedAt: '2026-06-15T12:00:00Z', active: true },
  { id: 'sp2', corridor: 'USD-NGN', tier: 'Business', bps: 75, fixedMinor: 0, minBps: 50, maxBps: 150, version: 2, updatedAt: '2026-06-12T12:00:00Z', active: true },
  { id: 'sp3', corridor: 'USD-XAF', tier: 'Retail', bps: 150, fixedMinor: 50, minBps: 100, maxBps: 250, version: 1, updatedAt: '2026-06-10T12:00:00Z', active: true },
  { id: 'sp4', corridor: 'EUR-NGN', tier: 'Retail', bps: 110, fixedMinor: 0, minBps: 80, maxBps: 180, version: 3, updatedAt: '2026-06-14T12:00:00Z', active: false },
];

const RECON_RUNS: ReconRun[] = [
  { id: 'run1', provider: 'eversend', date: '2026-06-18', matched: 642, breaks: 1, status: 'breaks' },
  { id: 'run2', provider: 'maplerad', date: '2026-06-18', matched: 511, breaks: 2, status: 'breaks' },
  { id: 'run3', provider: 'eversend', date: '2026-06-17', matched: 690, breaks: 0, status: 'clean' },
];

let RECON_BREAKS: ReconBreak[] = [
  { id: 'bk1', runId: 'run1', provider: 'eversend', reference: 'PMX-TR-77410', type: 'fee', expectedMinor: 1_05, actualMinor: 1_20, currency: 'USD', status: 'open', createdAt: '2026-06-18T23:10:00Z' },
  { id: 'bk2', runId: 'run2', provider: 'maplerad', reference: 'PMX-TR-77512', type: 'rate', expectedMinor: 60_250_00, actualMinor: 60_010_00, currency: 'XAF', status: 'investigating', createdAt: '2026-06-18T23:14:00Z' },
  { id: 'bk3', runId: 'run2', provider: 'maplerad', reference: 'PMX-CV-90044', type: 'timing', expectedMinor: 0, actualMinor: 0, currency: 'USD', status: 'open', createdAt: '2026-06-18T23:20:00Z' },
];

// ─── Overview ─────────────────────────────────────────────────────────────────

export async function getOverview(): Promise<FxOverview> {
  if (USE_MOCK) { await delay(); return OVERVIEW; }
  const res = await fetch(`${adminBase()}/overview`, { headers: authHeaders() });
  return res.json();
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function getTransactions(filter?: FxTxFilter): Promise<FxTxSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...TXNS];
    if (filter?.type) list = list.filter((t) => t.type === filter.type);
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.provider) list = list.filter((t) => t.provider === filter.provider);
    if (filter?.corridor) list = list.filter((t) => t.corridor === filter.corridor);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((t) => t.reference.toLowerCase().includes(q) || t.customer.toLowerCase().includes(q));
    }
    return list.map(({ rail, quotedRate, executedRate, fees, providerRef, customerEmail, narration, statusHistory, scoring, failureReason, ...s }) => s);
  }
  const res = await fetch(`${adminBase()}/transactions`, { headers: authHeaders() });
  return res.json();
}

export async function getTransaction(id: string): Promise<FxTxDetail> {
  if (USE_MOCK) {
    await delay();
    const found = TXNS.find((t) => t.id === id || t.reference === id);
    if (!found) throw new Error('Transaction not found');
    return found;
  }
  const res = await fetch(`${adminBase()}/transactions/${id}`, { headers: authHeaders() });
  return res.json();
}

export async function retryTransaction(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(500); const t = TXNS.find((x) => x.id === id); if (t) t.status = 'processing'; return { ok: true }; }
  await fetch(`${adminBase()}/transactions/${id}/retry`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:transaction-retry', id) } });
  return { ok: true };
}

export async function forceReverseTransaction(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(500); const t = TXNS.find((x) => x.id === id); if (t) t.status = 'reversed'; return { ok: true }; }
  await fetch(`${adminBase()}/transactions/${id}/reverse`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:transaction-reverse', id) } });
  return { ok: true };
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export async function getRoutingWeights(): Promise<RoutingWeights[]> {
  if (USE_MOCK) { await delay(); return WEIGHTS; }
  const res = await fetch(`${adminBase()}/routing`, { headers: authHeaders() });
  return res.json();
}

export async function saveRoutingWeights(rows: RoutingWeights[]): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(400); WEIGHTS = rows; return { ok: true }; }
  await fetch(`${adminBase()}/routing`, { method: 'PUT', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:routing-save') }, body: JSON.stringify(rows) });
  return { ok: true };
}

export async function simulateRoute(corridor: string, amountUsdCents: number): Promise<RouteSimResult> {
  if (USE_MOCK) {
    await delay(450);
    const big = amountUsdCents > 500_000_00;
    const ranked: RouteSimResult['ranked'] = [
      { provider: 'eversend' as Provider, allInRate: 1581.43, score: big ? 0.94 : 0.9, viable: true },
      { provider: 'maplerad' as Provider, allInRate: 1576.1, score: big ? 0.88 : 0.92, viable: true, note: big ? 'Deeper book preferred for large ticket' : 'Lower fixed fee for small ticket' },
    ];
    ranked.sort((a, b) => b.score - a.score);
    return { corridor, amountUsdCents, ranked };
  }
  const res = await fetch(`${adminBase()}/routing/simulate`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:route-simulate', corridor) }, body: JSON.stringify({ corridor, amountUsdCents }) });
  return res.json();
}

// ─── Providers ────────────────────────────────────────────────────────────────

export async function getProviders(): Promise<ProviderConfig[]> {
  if (USE_MOCK) { await delay(); return PROVIDERS; }
  const res = await fetch(`${adminBase()}/providers`, { headers: authHeaders() });
  return res.json();
}

export async function toggleProvider(provider: Provider, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(300); PROVIDERS = PROVIDERS.map((p) => (p.provider === provider ? { ...p, enabled } : p)); return { ok: true }; }
  await fetch(`${adminBase()}/providers/${provider}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:provider-toggle', provider) }, body: JSON.stringify({ enabled }) });
  return { ok: true };
}

export async function setBreaker(provider: Provider, state: ProviderConfig['breaker']): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(300); PROVIDERS = PROVIDERS.map((p) => (p.provider === provider ? { ...p, breaker: state } : p)); return { ok: true }; }
  await fetch(`${adminBase()}/providers/${provider}/breaker`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:provider-breaker', provider) }, body: JSON.stringify({ state }) });
  return { ok: true };
}

// ─── Treasury ─────────────────────────────────────────────────────────────────

export async function getFloats(): Promise<FloatBucket[]> {
  if (USE_MOCK) { await delay(); return FLOATS; }
  const res = await fetch(`${adminBase()}/treasury/floats`, { headers: authHeaders() });
  return res.json();
}

export async function getRebalances(): Promise<RebalanceEvent[]> {
  if (USE_MOCK) { await delay(); return REBALANCES; }
  const res = await fetch(`${adminBase()}/treasury/rebalances`, { headers: authHeaders() });
  return res.json();
}

export async function rebalanceNow(bucket: FloatBucket, path: 'fiat' | 'stablecoin'): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(600);
    FLOATS = FLOATS.map((f) => (f.provider === bucket.provider && f.currency === bucket.currency ? { ...f, balanceMinor: f.lowWaterMinor + (f.highWaterMinor - f.lowWaterMinor) / 2, status: 'healthy' } : f));
    return { ok: true };
  }
  await fetch(`${adminBase()}/treasury/rebalance`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:treasury-rebalance', bucket.provider, bucket.currency) }, body: JSON.stringify({ provider: bucket.provider, currency: bucket.currency, path }) });
  return { ok: true };
}

// ─── Spread ───────────────────────────────────────────────────────────────────

export async function getSpreadRules(): Promise<SpreadRule[]> {
  if (USE_MOCK) { await delay(); return SPREADS; }
  const res = await fetch(`${adminBase()}/spread`, { headers: authHeaders() });
  return res.json();
}

export async function updateSpreadRule(id: string, patch: Partial<SpreadRule>): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(350);
    SPREADS = SPREADS.map((s) => (s.id === id ? { ...s, ...patch, version: s.version + 1, updatedAt: new Date().toISOString() } : s));
    return { ok: true };
  }
  await fetch(`${adminBase()}/spread/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:spread-update', id) }, body: JSON.stringify(patch) });
  return { ok: true };
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export async function getReconRuns(): Promise<ReconRun[]> {
  if (USE_MOCK) { await delay(); return RECON_RUNS; }
  const res = await fetch(`${adminBase()}/recon/runs`, { headers: authHeaders() });
  return res.json();
}

export async function getReconBreaks(): Promise<ReconBreak[]> {
  if (USE_MOCK) { await delay(); return RECON_BREAKS; }
  const res = await fetch(`${adminBase()}/recon/breaks`, { headers: authHeaders() });
  return res.json();
}

export async function resolveReconBreak(id: string, status: ReconBreak['status']): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(300); RECON_BREAKS = RECON_BREAKS.map((b) => (b.id === id ? { ...b, status } : b)); return { ok: true }; }
  await fetch(`${adminBase()}/recon/breaks/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:recon-break-resolve', id) }, body: JSON.stringify({ status }) });
  return { ok: true };
}

// ─── G. Customers (KYC/KYB) ───────────────────────────────────────────────────

let CUSTOMERS: CustomerDetail[] = [
  {
    id: 'cus_91', name: 'Acme Ltd', email: 'ops@acme.example', type: 'business', verification: 'review', tier: 2,
    country: 'NG', balanceUsdCents: 3_420_00, createdAt: '2026-05-30T10:00:00Z',
    rcNumber: 'RC-1234567', directors: [{ name: 'Ada Obi', role: 'CEO', ownershipPct: '60' }, { name: 'Tunde A.', role: 'Director', ownershipPct: '40' }],
    documents: [{ id: 'd1', label: 'Certificate of incorporation', type: 'pdf', verified: true }, { id: 'd2', label: 'CAC status report', type: 'pdf', verified: false }],
    riskScore: 34, notes: null,
  },
  {
    id: 'cus_44', name: 'Jane Doe', email: 'jane@example.com', type: 'individual', verification: 'pending', tier: 1,
    country: 'NG', balanceUsdCents: 980_00, createdAt: '2026-06-12T10:00:00Z',
    documents: [{ id: 'd3', label: 'NIN slip', type: 'image', verified: true }], riskScore: 12, notes: null,
  },
  {
    id: 'cus_77', name: 'Kwame Mensah', email: 'kwame@example.com', type: 'individual', verification: 'approved', tier: 1,
    country: 'GH', balanceUsdCents: 120_00, createdAt: '2026-04-18T10:00:00Z',
    documents: [{ id: 'd4', label: 'Passport', type: 'image', verified: true }], riskScore: 8, notes: 'Repeat payout customer.',
  },
  {
    id: 'cus_12', name: 'QuickCoin Traders', email: 'hi@quickcoin.example', type: 'business', verification: 'rejected', tier: 0,
    country: 'NG', balanceUsdCents: 0, createdAt: '2026-06-01T10:00:00Z',
    rcNumber: 'RC-0000000', documents: [{ id: 'd5', label: 'Uploaded doc', type: 'pdf', verified: false }],
    riskScore: 88, notes: 'Documents failed verification; suspected shell entity.',
  },
];

export async function getCustomers(): Promise<AdminCustomer[]> {
  if (USE_MOCK) {
    await delay();
    return CUSTOMERS.map(({ documents, directors, rcNumber, riskScore, notes, ...c }) => c);
  }
  const res = await fetch(`${adminBase()}/customers`, { headers: authHeaders() });
  return res.json();
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  if (USE_MOCK) {
    await delay();
    const c = CUSTOMERS.find((x) => x.id === id);
    if (!c) throw new Error('Customer not found');
    return c;
  }
  const res = await fetch(`${adminBase()}/customers/${id}`, { headers: authHeaders() });
  return res.json();
}

export async function setCustomerVerification(id: string, verification: CustomerVerification): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(350);
    CUSTOMERS = CUSTOMERS.map((c) => (c.id === id ? { ...c, verification, tier: verification === 'approved' ? Math.max(c.tier, 1) : c.tier } : c));
    return { ok: true };
  }
  await fetch(`${adminBase()}/customers/${id}/verification`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:customer-verification', id) }, body: JSON.stringify({ verification }) });
  return { ok: true };
}

// ─── H. Compliance & Risk ─────────────────────────────────────────────────────

let ALERTS: ScreeningAlert[] = [
  { id: 'al1', customer: 'QuickCoin Traders', kind: 'sanctions', reference: null, detail: 'Name match (82%) against OFAC SDN list.', severity: 'high', status: 'open', createdAt: '2026-06-19T08:00:00Z' },
  { id: 'al2', customer: 'Jane Doe', kind: 'velocity', reference: 'PMX-TR-77810', detail: '5 payouts in 10 minutes exceeds velocity rule.', severity: 'medium', status: 'in_review', createdAt: '2026-06-19T09:10:00Z' },
  { id: 'al3', customer: 'Acme Ltd', kind: 'aml_rule', reference: 'PMX-CV-90021', detail: 'Large conversion just below reporting threshold.', severity: 'low', status: 'open', createdAt: '2026-06-19T10:25:00Z' },
  { id: 'al4', customer: 'Bola I.', kind: 'pep', reference: null, detail: 'Possible politically-exposed person match.', severity: 'medium', status: 'cleared', createdAt: '2026-06-18T14:00:00Z' },
];

export async function getScreeningAlerts(): Promise<ScreeningAlert[]> {
  if (USE_MOCK) { await delay(); return ALERTS; }
  const res = await fetch(`${adminBase()}/compliance/alerts`, { headers: authHeaders() });
  return res.json();
}

export async function setAlertStatus(id: string, status: CaseStatus, reason?: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(300); ALERTS = ALERTS.map((a) => (a.id === id ? { ...a, status } : a)); return { ok: true }; }
  await fetch(`${adminBase()}/compliance/alerts/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:alert-status', id) }, body: JSON.stringify({ status, reason }) });
  return { ok: true };
}

// ─── L. Webhooks & Developer ──────────────────────────────────────────────────

let ENDPOINTS: WebhookEndpoint[] = [
  { id: 'wh1', customer: 'Acme Ltd', url: 'https://acme.example/hooks/paymax', events: ['transfer.paid', 'conversion.settled', 'collection.received'], enabled: true, sandbox: false },
  { id: 'wh2', customer: 'Jane Doe', url: 'https://jane.example/pmx', events: ['transfer.paid', 'transfer.failed'], enabled: true, sandbox: true },
];

const DELIVERIES: WebhookDelivery[] = [
  { id: 'd1', endpointId: 'wh1', event: 'transfer.paid', status: 'delivered', attempts: 1, responseCode: 200, createdAt: '2026-06-19T09:03:00Z' },
  { id: 'd2', endpointId: 'wh1', event: 'conversion.settled', status: 'retrying', attempts: 3, responseCode: 503, createdAt: '2026-06-19T10:22:00Z' },
  { id: 'd3', endpointId: 'wh2', event: 'transfer.failed', status: 'failed', attempts: 6, responseCode: 500, createdAt: '2026-06-19T07:41:00Z' },
  { id: 'd4', endpointId: 'wh1', event: 'collection.received', status: 'delivered', attempts: 1, responseCode: 200, createdAt: '2026-06-19T06:11:00Z' },
];

const API_KEYS: ApiKey[] = [
  { id: 'k1', customer: 'Acme Ltd', label: 'Production', prefix: 'sk_live_8x21', mode: 'live', lastUsed: '2026-06-19T10:20:00Z', createdAt: '2026-05-30T10:00:00Z' },
  { id: 'k2', customer: 'Acme Ltd', label: 'Sandbox', prefix: 'sk_test_4a90', mode: 'sandbox', lastUsed: '2026-06-18T18:00:00Z', createdAt: '2026-05-30T10:00:00Z' },
  { id: 'k3', customer: 'Jane Doe', label: 'Default', prefix: 'sk_test_1f02', mode: 'sandbox', lastUsed: null, createdAt: '2026-06-12T10:00:00Z' },
];

export async function getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
  if (USE_MOCK) { await delay(); return ENDPOINTS; }
  const res = await fetch(`${adminBase()}/webhooks/endpoints`, { headers: authHeaders() });
  return res.json();
}

export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> {
  if (USE_MOCK) { await delay(); return DELIVERIES; }
  const res = await fetch(`${adminBase()}/webhooks/deliveries`, { headers: authHeaders() });
  return res.json();
}

export async function replayDelivery(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(400); const d = DELIVERIES.find((x) => x.id === id); if (d) { d.status = 'delivered'; d.responseCode = 200; d.attempts += 1; } return { ok: true }; }
  await fetch(`${adminBase()}/webhooks/deliveries/${id}/replay`, { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:webhook-replay', id) } });
  return { ok: true };
}

export async function toggleEndpoint(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(250); ENDPOINTS = ENDPOINTS.map((e) => (e.id === id ? { ...e, enabled } : e)); return { ok: true }; }
  await fetch(`${adminBase()}/webhooks/endpoints/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:webhook-endpoint-toggle', id) }, body: JSON.stringify({ enabled }) });
  return { ok: true };
}

export async function getApiKeys(): Promise<ApiKey[]> {
  if (USE_MOCK) { await delay(); return API_KEYS; }
  const res = await fetch(`${adminBase()}/webhooks/api-keys`, { headers: authHeaders() });
  return res.json();
}

// ─── M. Analytics & Reports ───────────────────────────────────────────────────

export async function getAnalytics(): Promise<FxAnalytics> {
  if (USE_MOCK) {
    await delay();
    return {
      marginByCorridor: [
        { corridor: 'USD-NGN', volumeUsdCents: 1_920_000_00, marginUsdCents: 22_400_00, marginBps: 117 },
        { corridor: 'USD-XAF', volumeUsdCents: 640_000_00, marginUsdCents: 9_100_00, marginBps: 142 },
        { corridor: 'EUR-NGN', volumeUsdCents: 580_000_00, marginUsdCents: 7_300_00, marginBps: 126 },
        { corridor: 'USD-GHS', volumeUsdCents: 410_000_00, marginUsdCents: 5_200_00, marginBps: 127 },
      ],
      providerReliability: [
        { provider: 'eversend', successRate: 98.7, avgLatencyMs: 540, failovers: 6, uptime: 99.9 },
        { provider: 'maplerad', successRate: 97.9, avgLatencyMs: 690, failovers: 11, uptime: 99.5 },
      ],
      routingEfficiency: [
        { corridor: 'USD-NGN', chosenVsBestBps: 2.1, optimalPct: 96 },
        { corridor: 'USD-XAF', chosenVsBestBps: 4.8, optimalPct: 88 },
        { corridor: 'EUR-NGN', chosenVsBestBps: 1.4, optimalPct: 98 },
      ],
      retentionCohorts: [
        { cohort: 'Mar 2026', m1: 100, m2: 71, m3: 58 },
        { cohort: 'Apr 2026', m1: 100, m2: 74, m3: 61 },
        { cohort: 'May 2026', m1: 100, m2: 78, m3: 0 },
      ],
    };
  }
  const res = await fetch(`${adminBase()}/analytics`, { headers: authHeaders() });
  return res.json();
}

// ─── J. Beneficiaries & Collections ───────────────────────────────────────────

const VA_REGISTRY: VirtualAccountReg[] = [
  { id: 'va1', customer: 'Acme Ltd', currency: 'USD', type: 'iban', identifier: 'GB29NWBK60161331926819', provider: 'eversend', status: 'active', createdAt: '2026-05-20T10:00:00Z' },
  { id: 'va2', customer: 'Acme Ltd', currency: 'NGN', type: 'virtual_account', identifier: '9901234567', provider: 'maplerad', status: 'active', createdAt: '2026-05-21T10:00:00Z' },
  { id: 'va3', customer: 'Jane Doe', currency: 'NGN', type: 'virtual_account', identifier: '9907654321', provider: 'maplerad', status: 'active', createdAt: '2026-06-12T10:00:00Z' },
  { id: 'va4', customer: 'Kwame Mensah', currency: 'USD', type: 'iban', identifier: 'GB12ABCD09876543210987', provider: 'eversend', status: 'closed', createdAt: '2026-04-18T10:00:00Z' },
];

const COLLECTION_EVENTS: AdminCollectionEvent[] = [
  { id: 'ce1', customer: 'Acme Ltd', amountMinor: 1_200_00, currency: 'USD', sender: 'Stripe Payouts', reference: 'INV-2031', createdAt: '2026-06-19T06:11:00Z' },
  { id: 'ce2', customer: 'Acme Ltd', amountMinor: 350_000_00, currency: 'NGN', sender: 'Adaeze Nwosu', reference: 'Rent', createdAt: '2026-06-18T15:00:00Z' },
  { id: 'ce3', customer: 'Jane Doe', amountMinor: 80_000_00, currency: 'NGN', sender: 'Salary', reference: 'June pay', createdAt: '2026-06-18T09:00:00Z' },
];

const BEN_ISSUES: BeneficiaryValidationIssue[] = [
  { id: 'bi1', corridor: 'USD-GHS', beneficiary: 'Kwame Mensah', rail: 'mobile_money', reason: 'Vodafone Cash number failed name resolution', count: 3 },
  { id: 'bi2', corridor: 'USD-XAF', beneficiary: 'Various', rail: 'mobile_money', reason: 'Operator timeout during validation', count: 5 },
];

export async function getVaRegistry(): Promise<VirtualAccountReg[]> {
  if (USE_MOCK) { await delay(); return VA_REGISTRY; }
  const res = await fetch(`${adminBase()}/collections/registry`, { headers: authHeaders() });
  return res.json();
}
export async function getCollectionEvents(): Promise<AdminCollectionEvent[]> {
  if (USE_MOCK) { await delay(); return COLLECTION_EVENTS; }
  const res = await fetch(`${adminBase()}/collections/events`, { headers: authHeaders() });
  return res.json();
}
export async function getBeneficiaryIssues(): Promise<BeneficiaryValidationIssue[]> {
  if (USE_MOCK) { await delay(); return BEN_ISSUES; }
  const res = await fetch(`${adminBase()}/collections/beneficiary-issues`, { headers: authHeaders() });
  return res.json();
}

// ─── K. Cards ─────────────────────────────────────────────────────────────────

let ISSUED_CARDS: IssuedCard[] = [
  { id: 'ic1', customer: 'Acme Ltd', brand: 'visa', currency: 'USD', last4: '4242', status: 'active', provider: 'maplerad', balanceMinor: 420_00, spentMinor: 86_40, createdAt: '2026-04-20T10:00:00Z' },
  { id: 'ic2', customer: 'Acme Ltd', brand: 'mastercard', currency: 'USD', last4: '5588', status: 'frozen', provider: 'maplerad', balanceMinor: 1_250_00, spentMinor: 0, createdAt: '2026-05-30T10:00:00Z' },
  { id: 'ic3', customer: 'Jane Doe', brand: 'visa', currency: 'USD', last4: '9012', status: 'active', provider: 'maplerad', balanceMinor: 60_00, spentMinor: 44_10, createdAt: '2026-06-12T10:00:00Z' },
];

const SUSPICIOUS: SuspiciousCardActivity[] = [
  { id: 'sc1', cardId: 'ic3', customer: 'Jane Doe', reason: '4 declines in 2 minutes at foreign merchant', severity: 'high', createdAt: '2026-06-19T08:30:00Z' },
  { id: 'sc2', cardId: 'ic1', customer: 'Acme Ltd', reason: 'Charge from new MCC (gambling)', severity: 'medium', createdAt: '2026-06-18T20:00:00Z' },
];

export async function getIssuedCards(): Promise<IssuedCard[]> {
  if (USE_MOCK) { await delay(); return ISSUED_CARDS; }
  const res = await fetch(`${adminBase()}/cards`, { headers: authHeaders() });
  return res.json();
}
export async function setIssuedCardStatus(id: string, status: IssuedCardStatus): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(300); ISSUED_CARDS = ISSUED_CARDS.map((c) => (c.id === id ? { ...c, status } : c)); return { ok: true }; }
  await fetch(`${adminBase()}/cards/${id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:card-status', id) }, body: JSON.stringify({ status }) });
  return { ok: true };
}
export async function getSuspiciousCardActivity(): Promise<SuspiciousCardActivity[]> {
  if (USE_MOCK) { await delay(); return SUSPICIOUS; }
  const res = await fetch(`${adminBase()}/cards/suspicious`, { headers: authHeaders() });
  return res.json();
}

// ─── N. Settings: catalogues + feature flags ──────────────────────────────────

let CATALOGUE: FxSettingsCatalogue = {
  corridors: [
    { corridor: 'USD-NGN', enabled: true, defaultProvider: 'auto' },
    { corridor: 'EUR-NGN', enabled: true, defaultProvider: 'eversend' },
    { corridor: 'GBP-NGN', enabled: true, defaultProvider: 'auto' },
    { corridor: 'USD-XAF', enabled: true, defaultProvider: 'maplerad' },
    { corridor: 'USD-GHS', enabled: true, defaultProvider: 'eversend' },
    { corridor: 'USD-KES', enabled: false, defaultProvider: 'eversend' },
  ],
  currencies: [
    { code: 'NGN', name: 'Nigerian Naira', kind: 'fiat', enabled: true },
    { code: 'USD', name: 'US Dollar', kind: 'fiat', enabled: true },
    { code: 'EUR', name: 'Euro', kind: 'fiat', enabled: true },
    { code: 'GBP', name: 'British Pound', kind: 'fiat', enabled: true },
    { code: 'GHS', name: 'Ghanaian Cedi', kind: 'fiat', enabled: true },
    { code: 'KES', name: 'Kenyan Shilling', kind: 'fiat', enabled: false },
    { code: 'XAF', name: 'Central African CFA', kind: 'fiat', enabled: true },
    { code: 'USDC', name: 'USD Coin', kind: 'stablecoin', enabled: true },
    { code: 'USDT', name: 'Tether USD', kind: 'stablecoin', enabled: true },
  ],
  rails: [
    { rail: 'bank_transfer', label: 'Bank transfer', enabled: true },
    { rail: 'mobile_money', label: 'Mobile money', enabled: true },
    { rail: 'iban', label: 'IBAN (ACH/SEPA)', enabled: true },
    { rail: 'wallet', label: 'Paymax wallet', enabled: true },
    { rail: 'stablecoin', label: 'Stablecoin', enabled: true },
  ],
  flags: [
    { key: 'fx_orchestration', label: 'FX orchestration', enabled: true },
    { key: 'cards', label: 'Virtual cards', enabled: true },
    { key: 'collections', label: 'Collections (VA/IBAN)', enabled: true },
    { key: 'stablecoin_rebalance', label: 'Stablecoin treasury rebalancing', enabled: true },
    { key: 'maker_checker', label: 'Maker-checker approvals (business)', enabled: true },
    { key: 'auto_failover', label: 'Provider auto-failover', enabled: true },
  ],
};

export async function getCatalogue(): Promise<FxSettingsCatalogue> {
  if (USE_MOCK) { await delay(); return CATALOGUE; }
  const res = await fetch(`${adminBase()}/settings/catalogue`, { headers: authHeaders() });
  return res.json();
}

export async function toggleFlag(key: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(250); CATALOGUE = { ...CATALOGUE, flags: CATALOGUE.flags.map((f) => (f.key === key ? { ...f, enabled } : f)) }; return { ok: true }; }
  await fetch(`${adminBase()}/settings/flags/${key}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:flag-toggle', key) }, body: JSON.stringify({ enabled }) });
  return { ok: true };
}

export async function toggleCorridor(corridor: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(250); CATALOGUE = { ...CATALOGUE, corridors: CATALOGUE.corridors.map((c) => (c.corridor === corridor ? { ...c, enabled } : c)) }; return { ok: true }; }
  await fetch(`${adminBase()}/settings/corridors/${corridor}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:corridor-toggle', corridor) }, body: JSON.stringify({ enabled }) });
  return { ok: true };
}

export async function toggleCurrency(code: string, enabled: boolean): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(250); CATALOGUE = { ...CATALOGUE, currencies: CATALOGUE.currencies.map((c) => (c.code === code ? { ...c, enabled } : c)) }; return { ok: true }; }
  await fetch(`${adminBase()}/settings/currencies/${code}`, { method: 'PATCH', headers: { ...authHeaders(), 'Idempotency-Key': operationKey('fx:currency-toggle', code) }, body: JSON.stringify({ enabled }) });
  return { ok: true };
}
