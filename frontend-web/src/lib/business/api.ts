// ── Business Registry (CAC) typed client ───────────────────────────────────
// Wraps the Go backend's member endpoints exposed under /api/finance/business
// (proxied verbatim by the next.config.mjs rewrite, which forwards the Bearer
// token and Idempotency-Key headers). All responses are shaped `{ data: ... }`
// and are unwrapped here. Money is kobo (minor units) — never float math.
'use client';

import { authFetch } from '@/src/lib/auth/flow';

const BASE = '/api/finance/business';

export type BusinessEntityType = 'business_name' | 'company' | 'incorporated_trustee';
export type BusinessMode = 'verify_existing' | 'register_new';
export type BusinessStatus =
  | 'draft'
  | 'name_check'
  | 'name_reserved'
  | 'registration_submitted'
  | 'under_review'
  | 'registered'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'failed';

export interface Proprietor {
  fullName: string;
  role?: string;
  sharePct?: number;
  phone?: string;
  email?: string;
  bvn?: string;
  nin?: string;
}

export interface Business {
  id: string;
  userId: string;
  entityType: BusinessEntityType;
  mode: BusinessMode;
  legalName?: string | null;
  proposedName?: string | null;
  lineOfBusiness?: string | null;
  status: BusinessStatus;
  rcOrBnNumber?: string | null;
  cacReservationRef?: string | null;
  cacRegistrationRef?: string | null;
  verificationSource?: string | null;
  registeredAt?: string | null;
  /** CAC certificate URL — present once registered and CAC has issued the certificate. */
  certificateUrl?: string;
  feeKobo?: number | null;
  feeLedgerRef?: string | null;
  metadata?: Record<string, unknown> | null;
  proprietors?: Proprietor[];
  createdAt?: string;
  updatedAt?: string;
}

export interface NameCheckResult {
  business?: Business;
  available: boolean;
  status?: BusinessStatus;
  reason?: string;
  suggestions?: string[];
}

// ── request payloads ────────────────────────────────────────────────────────
export interface NameCheckInput {
  proposedName: string;
  lineOfBusiness?: string;
  businessId?: string;
}

export interface VerifyInput {
  rcOrBnNumber: string;
  entityType?: BusinessEntityType;
}

export interface RegisterInput {
  entityType: BusinessEntityType;
  proposedName: string;
  lineOfBusiness?: string;
  address?: string;
  objects?: string;
  documentRefs?: string[];
  proprietors?: Proprietor[];
}

// ── helpers ───────────────────────────────────────────────────────────────
function idempotencyKey(scope: string, id: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `BIZ-${scope}-${id}-${Date.now()}-${random}`;
}

async function unwrap<T>(res: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const message =
      payload?.error || payload?.message || payload?.data?.reason || `Request failed (${res.status}).`;
    throw new Error(typeof message === 'string' ? message : 'Request failed.');
  }
  return (payload?.data ?? payload) as T;
}

// ── endpoints ──────────────────────────────────────────────────────────────
export async function listMyBusinesses(): Promise<Business[]> {
  const res = await authFetch(`${BASE}/me`, { cache: 'no-store' });
  return unwrap<Business[]>(res);
}

export async function getBusiness(id: string): Promise<Business> {
  const res = await authFetch(`${BASE}/${id}`, { cache: 'no-store' });
  return unwrap<Business>(res);
}

export async function getBusinessStatus(id: string): Promise<Business> {
  const res = await authFetch(`${BASE}/${id}/status`, { cache: 'no-store' });
  return unwrap<Business>(res);
}

// GET /:id/certificate → { data: { certificateUrl } }. Returns 404 with
// { error: 'certificate not available yet' } until CAC has issued it — unwrap()
// throws that message, which callers surface gracefully.
export async function getCertificate(id: string): Promise<{ certificateUrl: string }> {
  const res = await authFetch(`${BASE}/${id}/certificate`, { cache: 'no-store' });
  return unwrap<{ certificateUrl: string }>(res);
}

export async function checkName(input: NameCheckInput): Promise<NameCheckResult> {
  const res = await authFetch(
    `${BASE}/name/check`,
    { method: 'POST', body: JSON.stringify(input) },
    { json: true },
  );
  return unwrap<NameCheckResult>(res);
}

export async function reserveName(businessId: string): Promise<Business> {
  const res = await authFetch(
    `${BASE}/name/reserve`,
    { method: 'POST', body: JSON.stringify({ businessId }) },
    { json: true },
  );
  return unwrap<Business>(res);
}

export async function verifyBusiness(input: VerifyInput): Promise<Business> {
  const res = await authFetch(
    `${BASE}/verify`,
    { method: 'POST', body: JSON.stringify(input) },
    { json: true },
  );
  return unwrap<Business>(res);
}

export async function registerBusiness(input: RegisterInput): Promise<Business> {
  const res = await authFetch(
    `${BASE}/register`,
    { method: 'POST', body: JSON.stringify(input) },
    { json: true },
  );
  return unwrap<Business>(res);
}

export async function payBusinessFee(id: string): Promise<Business> {
  // Money mutation — MUST send an Idempotency-Key (CLAUDE.md iron rule). The
  // next.config rewrite forwards this header verbatim to the Go backend.
  const res = await authFetch(
    `${BASE}/${id}/pay-fee`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey('PAY', id) } },
    { json: true },
  );
  return unwrap<Business>(res);
}

// ── Fee via payment gateway (Paystack) — alternative to the wallet debit ──────

export type PaystackInit = { reference: string; authorizationUrl: string; alreadyPaid?: boolean };

/** POST /:id/pay-fee/paystack — start a Paystack checkout for the CAC fee. */
export async function initBusinessFeePaystack(id: string, email?: string): Promise<PaystackInit> {
  const callbackUrl = typeof window !== 'undefined' ? window.location.href : '';
  const res = await authFetch(
    `${BASE}/${id}/pay-fee/paystack`,
    { method: 'POST', body: JSON.stringify({ email: email ?? '', callbackUrl }) },
    { json: true },
  );
  return unwrap<PaystackInit>(res);
}

/** POST /:id/pay-fee/paystack/verify — confirm the Paystack fee payment. */
export async function verifyBusinessFeePaystack(id: string, reference: string): Promise<Business> {
  const res = await authFetch(
    `${BASE}/${id}/pay-fee/paystack/verify`,
    { method: 'POST', body: JSON.stringify({ reference }) },
    { json: true },
  );
  return unwrap<Business>(res);
}

export async function submitBusiness(id: string): Promise<Business> {
  const res = await authFetch(
    `${BASE}/${id}/submit`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey('SUBMIT', id) } },
    { json: true },
  );
  return unwrap<Business>(res);
}
