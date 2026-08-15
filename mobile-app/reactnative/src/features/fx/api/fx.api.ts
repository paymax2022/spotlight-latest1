// ── FX Exchange — API wrapper ────────────────────────────────────────────────
// Typed data layer the screens code against (Backend role owns this file).
// Mirrors crowdfunding.api.ts: mock-flagged. Flip USE_MOCK=false once the real
// Paymax /v1 endpoints land.
//
// IRON RULES honoured here:
//  • all money is integer minor units;
//  • every money mutation carries an Idempotency-Key;
//  • quote → (lock) → execute against a quote_id (price never assumed stable).

import { api } from '@/api/client';
import type {
  WalletBalance,
  IndicativeRate,
  RatePoint,
  RateRange,
  Quote,
  QuoteRequest,
  Conversion,
  Transfer,
  Beneficiary,
  NewBeneficiaryDraft,
  VirtualAccount,
  VirtualAccountType,
  CollectionEvent,
  TransactionSummary,
  TransactionDetail,
  TransactionFilter,
  RateAlert,
  NewRateAlertDraft,
  SendDraft,
  CurrencyCode,
} from '../types/fx.types';
import { buildQuote, midRate } from '../utils/fxFormatters';
import {
  MOCK_BALANCES,
  MOCK_RATES,
  MOCK_BENEFICIARIES,
  MOCK_VIRTUAL_ACCOUNTS,
  MOCK_COLLECTIONS,
  MOCK_TRANSACTIONS,
  MOCK_RATE_ALERTS,
} from './fx.mock';

// ─── Feature flag: flip to false once real endpoints are ready ─────────────────
// Mock by default; flip with EXPO_PUBLIC_FX_USE_MOCK=false to hit the Go backend.
const USE_MOCK = (process.env.EXPO_PUBLIC_FX_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
// Backend wraps success payloads as { data: ... }. Unwrap by KEY PRESENCE, not by
// nullishness — otherwise an empty result serialized as { data: null } would fall
// back to returning the wrapper object, breaking Array ops (e.g. balances.reduce).
const unwrap = <T>(res: { data: unknown }): T => {
  const body = res?.data;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
};

// Coerce a list payload to an array — a backend empty result may arrive as null.
const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

// The Go backend rejects with {"error": {type, code, message, ...}} (FxError).
// Axios only surfaces its own generic message, so the screens' `err.fxType`
// branches (e.g. the rate_expired → re-quote UX) never fired on live. Re-throw
// with fxType/message lifted from the envelope so mock and live behave alike.
const withFxError = async <T>(call: Promise<T>): Promise<T> => {
  try {
    return await call;
  } catch (err) {
    const body = (err as { response?: { data?: { error?: { type?: string; message?: string } } } })?.response?.data;
    const fxErr = body?.error;
    if (fxErr && typeof fxErr === 'object') {
      const e = new Error(fxErr.message || 'The request could not be completed.') as Error & { fxType?: string };
      e.fxType = fxErr.type;
      throw e;
    }
    throw err;
  }
};

// ─── Balances (GET /v1/balances) ──────────────────────────────────────────────

export async function getBalances(): Promise<WalletBalance[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_BALANCES]; }
  const r = unwrap<WalletBalance[]>(await api.get('/api/v1/fx/balances'));
  return Array.isArray(r) ? r : []; // empty FX wallets → null; normalise to []
}

/** Add (open) a new currency wallet. */
export async function addWallet(currency: CurrencyCode): Promise<WalletBalance> {
  if (USE_MOCK) {
    await delay(500);
    const existing = MOCK_BALANCES.find((b) => b.currency === currency);
    if (existing) return existing;
    const fresh: WalletBalance = { currency, available: 0, ledger: 0 };
    MOCK_BALANCES.push(fresh);
    return fresh;
  }
  return unwrap<WalletBalance>(await api.post('/api/v1/fx/balances', { currency }));
}

// ─── Rates (GET /v1/rates — display/alerts only) ──────────────────────────────

export async function getRates(): Promise<IndicativeRate[]> {
  if (USE_MOCK) { await delay(180); return [...MOCK_RATES]; }
  return arr(unwrap<IndicativeRate[]>(await api.get('/api/v1/fx/rates')));
}

/** Deterministic mock rate history for the rate-history chart. */
export async function getRateHistory(
  from: CurrencyCode,
  to: CurrencyCode,
  range: RateRange,
): Promise<RatePoint[]> {
  if (USE_MOCK) {
    await delay(260);
    const points = { '1D': 24, '1W': 28, '1M': 30, '3M': 36, '1Y': 52 }[range];
    const base = midRate(from, to);
    const seed = (from + to + range).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const stepMs = {
      '1D': 3_600_000, '1W': 6 * 3_600_000, '1M': 86_400_000,
      '3M': 3 * 86_400_000, '1Y': 7 * 86_400_000,
    }[range];
    return Array.from({ length: points }).map((_, i) => {
      const wobble = Math.sin((seed + i) / 3) * 0.02 + Math.cos((seed + i) / 7) * 0.012;
      return {
        t: new Date(Date.now() - (points - i) * stepMs).toISOString(),
        rate: +(base * (1 + wobble)).toFixed(4),
      };
    });
  }
  return arr(unwrap<RatePoint[]>(await api.get('/api/v1/fx/rates/history', { params: { from, to, range } })));
}

// ─── Quotes (POST /v1/quotes) ─────────────────────────────────────────────────

export async function createQuote(req: QuoteRequest): Promise<Quote> {
  if (USE_MOCK) { await delay(420); return buildQuote(req); }
  return unwrap<Quote>(await api.post('/api/v1/fx/quotes', req));
}

/** Lock a quote's rate (POST /v1/quotes/{id}/lock). */
export async function lockQuote(quoteId: string, req: QuoteRequest): Promise<Quote> {
  if (USE_MOCK) { await delay(260); return buildQuote({ ...req, lock: true }); }
  return unwrap<Quote>(await api.post(`/api/v1/fx/quotes/${quoteId}/lock`, {}));
}

// ─── Conversions (POST /v1/conversions) ───────────────────────────────────────

export async function executeConversion(
  quote: Quote,
  idempotencyKey: string,
): Promise<Conversion> {
  if (USE_MOCK) {
    await delay(1100);
    // Simulate expired-rate rejection so the re-quote path is reachable in mock.
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      const err = new Error('The quote has expired. Request a new quote.') as Error & { fxType?: string };
      err.fxType = 'rate_expired';
      throw err;
    }
    return {
      id: `cv_${Date.now()}`,
      reference: `PMX-CV-${Date.now().toString().slice(-6)}`,
      status: 'settled',
      source: quote.source,
      destination: quote.destination,
      rate: quote.rate,
      allInRate: quote.allInRate,
      fees: quote.fees,
      route: quote.route,
      transactionId: `tx_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
  }
  return unwrap<Conversion>(
    await withFxError(api.post('/api/v1/fx/conversions', { quote_id: quote.id }, { headers: { 'Idempotency-Key': idempotencyKey } })),
  );
}

// ─── Transfers / payouts (POST /v1/transfers) ─────────────────────────────────

export async function executeTransfer(
  draft: SendDraft,
  quote: Quote,
  beneficiary: Beneficiary,
  idempotencyKey: string,
): Promise<Transfer> {
  if (USE_MOCK) {
    await delay(1200);
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      const err = new Error('The quote has expired. Request a new quote.') as Error & { fxType?: string };
      err.fxType = 'rate_expired';
      throw err;
    }
    const ref = `PMX-TR-${Date.now().toString().slice(-6)}`;
    return {
      id: `tr_${Date.now()}`,
      reference: ref,
      status: 'processing',
      source: quote.source,
      destination: quote.destination,
      quotedRate: quote.rate,
      executedRate: quote.allInRate,
      fees: quote.fees,
      route: quote.route,
      beneficiary: {
        id: beneficiary.id, name: beneficiary.name, rail: beneficiary.rail,
        scheme: beneficiary.scheme, currency: beneficiary.currency,
        accountNumber: beneficiary.accountNumber, bankName: beneficiary.bankName,
        countryCode: beneficiary.countryCode,
      },
      narration: draft.narration,
      transactionId: `tx_${Date.now()}`,
      createdAt: new Date().toISOString(),
      statusHistory: [{ status: 'queued', at: new Date().toISOString() }],
    };
  }
  return unwrap<Transfer>(
    await withFxError(api.post(
      '/api/v1/fx/transfers',
      { quote_id: quote.id, beneficiary_id: beneficiary.id, narration: draft.narration, reference: draft.reference },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )),
  );
}

/** Poll/verify a transfer's terminal status (mock resolves to paid). */
export async function getTransfer(reference: string): Promise<Transfer> {
  if (USE_MOCK) {
    await delay(900);
    const base = MOCK_TRANSACTIONS.find((t) => t.type === 'transfer')!;
    return {
      id: base.id, reference, status: 'paid',
      source: base.source, destination: base.destination,
      quotedRate: base.quotedRate, executedRate: base.executedRate,
      fees: base.fees, route: base.route,
      beneficiary: {
        id: 'ben_1', name: base.counterparty?.split(' · ')[0] ?? 'Beneficiary',
        rail: base.route.rail, scheme: 'MOBILEMONEY', currency: base.destination.currency,
        accountNumber: '237670000000', bankName: 'MTN MoMo', countryCode: 'CM',
      },
      narration: base.narration, transactionId: base.id, createdAt: base.createdAt,
      statusHistory: base.statusHistory,
    };
  }
  return unwrap<Transfer>(await api.get(`/api/v1/fx/transfers/${reference}`));
}

// ─── Beneficiaries (GET/POST /v1/beneficiaries) ───────────────────────────────

export async function getBeneficiaries(): Promise<Beneficiary[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_BENEFICIARIES].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }
  return arr(unwrap<Beneficiary[]>(await api.get('/api/v1/fx/beneficiaries')));
}

export async function createBeneficiary(draft: NewBeneficiaryDraft): Promise<Beneficiary> {
  if (USE_MOCK) {
    await delay(600);
    const created: Beneficiary = {
      id: `ben_${Date.now()}`,
      ...draft,
      bankName: draft.bankName ?? null,
      validated: true,           // mock validation passes
      favorite: draft.favorite ?? false,
      createdAt: new Date().toISOString(),
    };
    MOCK_BENEFICIARIES.unshift(created);
    return created;
  }
  return unwrap<Beneficiary>(await api.post('/api/v1/fx/beneficiaries', draft));
}

/** Validate a beneficiary's account before saving (per-corridor name resolution). */
export async function validateBeneficiary(
  draft: NewBeneficiaryDraft,
): Promise<{ valid: boolean; resolvedName?: string; reason?: string }> {
  if (USE_MOCK) {
    await delay(700);
    if (draft.accountNumber.replace(/\D/g, '').length < 8 && draft.scheme !== 'STABLECOIN') {
      return { valid: false, reason: 'Account number looks too short for this rail.' };
    }
    return { valid: true, resolvedName: draft.name || 'Verified Account' };
  }
  return unwrap(await api.post('/api/v1/fx/beneficiaries/validate', draft));
}

/** Edit an existing beneficiary (re-validates account, per-corridor). */
export async function updateBeneficiary(
  id: string,
  draft: NewBeneficiaryDraft,
): Promise<Beneficiary> {
  if (USE_MOCK) {
    await delay(500);
    const b = MOCK_BENEFICIARIES.find((x) => x.id === id);
    if (!b) throw new Error('Beneficiary not found');
    Object.assign(b, draft, { bankName: draft.bankName ?? null, validated: true });
    return b;
  }
  return unwrap<Beneficiary>(await api.put(`/api/v1/fx/beneficiaries/${id}`, draft));
}

export async function toggleFavoriteBeneficiary(id: string, favorite: boolean): Promise<void> {
  if (USE_MOCK) {
    await delay(150);
    const b = MOCK_BENEFICIARIES.find((x) => x.id === id);
    if (b) b.favorite = favorite;
    return;
  }
  await api.patch(`/api/v1/fx/beneficiaries/${id}`, { favorite });
}

export async function deleteBeneficiary(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const i = MOCK_BENEFICIARIES.findIndex((x) => x.id === id);
    if (i >= 0) MOCK_BENEFICIARIES.splice(i, 1);
    return;
  }
  await api.delete(`/api/v1/fx/beneficiaries/${id}`);
}

// ─── Collections (POST /v1/collections/virtual-accounts) ──────────────────────

export async function getVirtualAccounts(): Promise<VirtualAccount[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_VIRTUAL_ACCOUNTS]; }
  return arr(unwrap<VirtualAccount[]>(await api.get('/api/v1/fx/collections/virtual-accounts')));
}

export async function createVirtualAccount(
  currency: CurrencyCode,
  type: VirtualAccountType,
  idempotencyKey: string,
): Promise<VirtualAccount> {
  if (USE_MOCK) {
    await delay(900);
    const created: VirtualAccount = {
      id: `va_${Date.now()}`,
      currency, type, status: 'active',
      provider: type === 'iban' ? 'eversend' : 'maplerad',
      createdAt: new Date().toISOString(),
      details: type === 'iban'
        ? { accountName: 'Paymax / Spotlight User', iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2L', rails: currency === 'EUR' ? ['SEPA'] : ['ACH'], reference: `PMX-COL-${currency}` }
        : { accountName: 'Paymax / Spotlight User', accountNumber: '99' + Math.floor(10_000_000 + Math.random() * 80_000_000), bankName: 'Providus Bank', reference: `PMX-COL-${currency}` },
    };
    MOCK_VIRTUAL_ACCOUNTS.push(created);
    return created;
  }
  return unwrap<VirtualAccount>(
    await api.post('/api/v1/fx/collections/virtual-accounts', { currency, type }, { headers: { 'Idempotency-Key': idempotencyKey } }),
  );
}

export async function getCollections(): Promise<CollectionEvent[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_COLLECTIONS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return arr(unwrap<CollectionEvent[]>(await api.get('/api/v1/fx/collections')));
}

// ─── Transactions (GET /v1/transactions[/{id}]) ───────────────────────────────

// Shared filter used by BOTH branches: the Go handler ignores query params
// today, so without this the filter chips silently do nothing on live data.
const applyTxFilter = <T extends TransactionSummary>(list: T[], filter?: TransactionFilter): T[] => {
  let out = list;
  if (filter?.type) out = out.filter((t) => t.type === filter.type);
  if (filter?.status) out = out.filter((t) => t.status === filter.status);
  if (filter?.currency) out = out.filter((t) => t.source.currency === filter.currency || t.destination.currency === filter.currency);
  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    out = out.filter((t) =>
      (t.title ?? '').toLowerCase().includes(q) ||
      (t.reference ?? '').toLowerCase().includes(q) ||
      ((t as { counterparty?: string }).counterparty ?? '').toLowerCase().includes(q));
  }
  return [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
};

export async function getTransactions(filter?: TransactionFilter): Promise<TransactionSummary[]> {
  if (USE_MOCK) {
    await delay();
    return applyTxFilter(MOCK_TRANSACTIONS, filter)
      .map(({ route, quotedRate, executedRate, fees, providerRef, counterparty, narration, statusHistory, ...summary }) => summary);
  }
  const list = arr(unwrap<TransactionSummary[]>(await api.get('/api/v1/fx/transactions', { params: filter })));
  return applyTxFilter(list, filter);
}

export async function disputeTransaction(draft: import('../types/fx.types').DisputeDraft): Promise<import('../types/fx.types').Dispute> {
  if (USE_MOCK) {
    await delay(600);
    return {
      id: `dsp_${Date.now()}`,
      transactionId: draft.transactionId,
      reference: draft.reference,
      reason: draft.reason,
      note: draft.note,
      status: 'submitted',
      createdAt: new Date().toISOString(),
    };
  }
  return unwrap(await api.post(`/api/v1/fx/transactions/${draft.transactionId}/dispute`, draft));
}

export async function getTransaction(id: string): Promise<TransactionDetail> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_TRANSACTIONS.find((t) => t.id === id || t.reference === id);
    if (!found) throw new Error('Transaction not found');
    return found;
  }
  return unwrap<TransactionDetail>(await api.get(`/api/v1/fx/transactions/${id}`));
}

// ─── Rate alerts ────────────────────────────────────────────────────────────────

export async function getRateAlerts(): Promise<RateAlert[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_RATE_ALERTS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return arr(unwrap<RateAlert[]>(await api.get('/api/v1/fx/rate-alerts')));
}

export async function createRateAlert(draft: NewRateAlertDraft): Promise<RateAlert> {
  if (USE_MOCK) {
    await delay(400);
    const created: RateAlert = {
      id: `al_${Date.now()}`,
      pair: `${draft.from}-${draft.to}`,
      from: draft.from, to: draft.to, direction: draft.direction, target: draft.target,
      active: true, createdAt: new Date().toISOString(), triggeredAt: null,
    };
    MOCK_RATE_ALERTS.unshift(created);
    return created;
  }
  return unwrap<RateAlert>(await api.post('/api/v1/fx/rate-alerts', draft));
}

export async function deleteRateAlert(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200);
    const i = MOCK_RATE_ALERTS.findIndex((a) => a.id === id);
    if (i >= 0) MOCK_RATE_ALERTS.splice(i, 1);
    return;
  }
  await api.delete(`/api/v1/fx/rate-alerts/${id}`);
}
