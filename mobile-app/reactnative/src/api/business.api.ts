/**
 * Business Registry API — CAC business-name verify + register.
 *
 * Wraps the authed finance group `/api/finance/business`. Every response is
 * shaped `{ data: ... }`; helpers below unwrap it. The `business` object is
 * already camelCase on the wire (see src/types/business.ts), so mapping is a
 * light normalisation (defaults + array coercion).
 *
 * Money-path note: pay-fee and submit are money mutations — each MUST carry an
 * `Idempotency-Key` (generated per attempt). Amounts are kobo integers.
 */
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  BusinessProfile,
  BusinessProprietor,
  NameCheckInput,
  NameCheckResult,
  RegisterNewInput,
  VerifyExistingInput,
} from '@/types/business';

const BASE = '/api/finance/business';

type ApiRecord = Record<string, unknown>;

/** Unwrap `{ data: ... }`, tolerating a bare payload. */
function unwrap<T = unknown>(payload: unknown): T {
  const body = payload as ApiRecord | undefined;
  return ((body?.data ?? body) as T);
}

function mapProprietor(raw: ApiRecord): BusinessProprietor {
  return {
    fullName: String(raw.fullName ?? ''),
    role:     (raw.role as string | undefined) ?? undefined,
    bvn:      (raw.bvn as string | undefined) ?? undefined,
    nin:      (raw.nin as string | undefined) ?? undefined,
    sharePct: raw.sharePct != null ? Number(raw.sharePct) : undefined,
    phone:    (raw.phone as string | undefined) ?? undefined,
    email:    (raw.email as string | undefined) ?? undefined,
  };
}

/** Normalise a raw business record into the typed shape (defaults + arrays). */
export function mapBusiness(raw: ApiRecord): BusinessProfile {
  const proprietors = Array.isArray(raw.proprietors)
    ? (raw.proprietors as ApiRecord[]).map(mapProprietor)
    : [];
  return {
    id:                 String(raw.id ?? ''),
    userId:             String(raw.userId ?? ''),
    entityType:         (raw.entityType as BusinessProfile['entityType']) ?? 'business_name',
    mode:               (raw.mode as BusinessProfile['mode']) ?? 'register_new',
    legalName:          (raw.legalName as string | null) ?? null,
    proposedName:       (raw.proposedName as string | null) ?? null,
    lineOfBusiness:     (raw.lineOfBusiness as string | null) ?? null,
    status:             (raw.status as BusinessProfile['status']) ?? 'draft',
    rcOrBnNumber:       (raw.rcOrBnNumber as string | null) ?? null,
    cacReservationRef:  (raw.cacReservationRef as string | null) ?? null,
    cacRegistrationRef: (raw.cacRegistrationRef as string | null) ?? null,
    verificationSource: (raw.verificationSource as string | null) ?? null,
    registeredAt:       (raw.registeredAt as string | null) ?? null,
    certificateUrl:     (raw.certificateUrl as string | undefined) ?? undefined,
    feeKobo:            raw.feeKobo != null ? Number(raw.feeKobo) : null,
    feeLedgerRef:       (raw.feeLedgerRef as string | null) ?? null,
    metadata:           (raw.metadata as Record<string, unknown> | null) ?? null,
    proprietors,
    createdAt:          String(raw.createdAt ?? new Date().toISOString()),
    updatedAt:          String(raw.updatedAt ?? new Date().toISOString()),
  };
}

// ── Name check / reserve ─────────────────────────────────────────────────────

/** POST /name/check — availability of a proposed name (+ optional suggestions). */
export async function checkName(input: NameCheckInput): Promise<NameCheckResult> {
  const res = await api.post(`${BASE}/name/check`, {
    proposedName:   input.proposedName.trim(),
    lineOfBusiness: input.lineOfBusiness?.trim() || undefined,
    businessId:     input.businessId || undefined,
  });
  const data = unwrap<ApiRecord>(res.data);
  return {
    business:    data.business ? mapBusiness(data.business as ApiRecord) : undefined,
    available:   Boolean(data.available),
    status:      (data.status as NameCheckResult['status']) ?? 'name_check',
    reason:      (data.reason as string | undefined) ?? undefined,
    suggestions: Array.isArray(data.suggestions) ? (data.suggestions as string[]) : undefined,
  };
}

/** POST /name/reserve — reserve a previously-checked draft name. */
export async function reserveName(businessId: string): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/name/reserve`, { businessId });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

// ── Verify existing ──────────────────────────────────────────────────────────

/** POST /verify — verify an EXISTING business by its RC/BN number. */
export async function verifyExisting(input: VerifyExistingInput): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/verify`, {
    rcOrBnNumber: input.rcOrBnNumber.trim(),
    entityType:   input.entityType,
  });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

// ── Register new ─────────────────────────────────────────────────────────────

/** POST /register — create a draft registration (201). */
export async function registerNew(input: RegisterNewInput): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/register`, {
    entityType:     input.entityType,
    proposedName:   input.proposedName.trim(),
    lineOfBusiness: input.lineOfBusiness?.trim() || undefined,
    address:        input.address?.trim() || undefined,
    objects:        input.objects?.trim() || undefined,
    documentRefs:   input.documentRefs && input.documentRefs.length ? input.documentRefs : undefined,
    proprietors:    input.proprietors && input.proprietors.length ? input.proprietors : undefined,
  });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

// ── Money-path: pay fee + submit (Idempotency-Key required) ──────────────────

/** POST /:id/pay-fee — debit the CAC fee. Idempotency-Key required. */
export async function payFee(id: string): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/${id}/pay-fee`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

/**
 * POST /:id/pay-fee/paystack — start a Paystack checkout for the CAC fee (the
 * payment-gateway alternative to the wallet debit). No money moves until verify.
 * Returns the authorization URL to open + the reference to verify on return.
 */
export async function initiateFeePaystack(
  id: string,
  email: string,
  callbackUrl?: string,
): Promise<{ authorizationUrl: string; reference: string; alreadyPaid?: boolean }> {
  const res = await api.post(`${BASE}/${id}/pay-fee/paystack`, { email, callbackUrl });
  const data = unwrap<ApiRecord>(res.data);
  return {
    authorizationUrl: String(data.authorizationUrl ?? ''),
    reference: String(data.reference ?? ''),
    alreadyPaid: Boolean(data.alreadyPaid),
  };
}

/** POST /:id/pay-fee/paystack/verify — confirm a Paystack fee payment and mark it paid. */
export async function verifyFeePaystack(id: string, reference: string): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/${id}/pay-fee/paystack/verify`, { reference });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

/** POST /:id/submit — submit the paid registration to CAC. Idempotency-Key required. */
export async function submit(id: string): Promise<BusinessProfile> {
  const res = await api.post(`${BASE}/${id}/submit`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

// ── Status / reads ───────────────────────────────────────────────────────────

/** GET /:id/status — poll CAC and advance state. */
export async function getStatus(id: string): Promise<BusinessProfile> {
  const res = await api.get(`${BASE}/${id}/status`);
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

/** GET /me — all businesses owned by the current user. */
export async function getMyBusinesses(): Promise<BusinessProfile[]> {
  const res = await api.get(`${BASE}/me`);
  const data = unwrap<ApiRecord[]>(res.data);
  return Array.isArray(data) ? data.map((b) => mapBusiness(b as ApiRecord)) : [];
}

/** GET /:id — a single business. */
export async function getBusiness(id: string): Promise<BusinessProfile> {
  const res = await api.get(`${BASE}/${id}`);
  return mapBusiness(unwrap<ApiRecord>(res.data));
}

/**
 * GET /:id/certificate — the issued CAC certificate URL.
 * Returns 404 (`{"error":"certificate not available yet"}`) until CAC has issued it;
 * callers should surface that gracefully.
 */
export async function getCertificate(id: string): Promise<{ certificateUrl: string }> {
  const res = await api.get(`${BASE}/${id}/certificate`);
  const data = unwrap<ApiRecord>(res.data);
  return { certificateUrl: String(data.certificateUrl ?? '') };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

/** True when a business grants the user a merchant-eligible identity. */
export function isBusinessActive(b: Pick<BusinessProfile, 'status'>): boolean {
  return b.status === 'registered' || b.status === 'verified';
}

/** Mask a sensitive 11-digit ID (BVN/NIN) for display, e.g. "•••••••1234". */
export function maskSensitiveId(value?: string): string {
  if (!value) return '';
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
