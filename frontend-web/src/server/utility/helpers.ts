import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiError } from '@/src/lib/api/responses';
import { validateAmountKobo } from '@/src/server/wallet/ledger';
import type {
  UtilityCategory,
  UtilityPricing,
  UtilityProductMappingRow,
  UtilityProductRow,
  UtilityProviderRow,
  UtilityTransactionStatus,
} from './types';

const terminalStatuses: ReadonlySet<UtilityTransactionStatus> = new Set([
  'successful',
  'failed',
  'reversed',
]);

export function isTerminalUtilityStatus(status: UtilityTransactionStatus) {
  return terminalStatuses.has(status);
}

export function canRequeryUtilityStatus(status: UtilityTransactionStatus) {
  return status === 'provider_pending' || status === 'wallet_debited' || status === 'initiated';
}

export function canReverseUtilityTransaction(status: UtilityTransactionStatus) {
  // 'disputed' is reversible: the dispute gate already required 'successful'
  // (a delivered vend with a proven debit), so the reversal is a real refund.
  return status === 'failed' || status === 'provider_pending' || status === 'wallet_debited' || status === 'disputed';
}

export function nextStatusFromProvider(providerStatus: 'successful' | 'pending' | 'failed'): UtilityTransactionStatus {
  if (providerStatus === 'successful') return 'successful';
  if (providerStatus === 'pending') return 'provider_pending';
  return 'failed';
}

export class UtilityProviderTimeoutError extends Error {
  timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Utility provider timed out after ${timeoutMs}ms.`);
    this.name = 'UtilityProviderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function getUtilityProviderTimeoutMs(config: Record<string, unknown> | null | undefined) {
  const configured = config?.timeout_ms;
  if (typeof configured === 'number' && Number.isInteger(configured) && configured >= 1_000) {
    return Math.min(configured, 120_000);
  }

  const envValue = Number(process.env.UTILITY_PROVIDER_TIMEOUT_MS || 15_000);
  if (Number.isInteger(envValue) && envValue >= 1_000) return Math.min(envValue, 120_000);

  return 15_000;
}

export async function withUtilityProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new UtilityProviderTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface UtilityRouteCandidate {
  provider: UtilityProviderRow;
  mapping: UtilityProductMappingRow;
  priority: number;
}

export function selectUtilityProvider(
  candidates: UtilityRouteCandidate[],
  input: { category: UtilityCategory; product: UtilityProductRow; amountKobo: number },
): UtilityRouteCandidate {
  const viable = getViableUtilityRoutes(candidates, input);

  const selected = viable[0];
  if (!selected) {
    throw new ApiError('No available provider route for this utility product.', 503);
  }

  return selected;
}

export function getViableUtilityRoutes(
  candidates: UtilityRouteCandidate[],
  input: { category: UtilityCategory; product: UtilityProductRow; amountKobo: number },
): UtilityRouteCandidate[] {
  return candidates
    .filter((candidate) => candidate.provider.status === 'active')
    .filter((candidate) => candidate.mapping.status === 'active')
    .filter((candidate) => candidate.provider.health_status !== 'down')
    .filter((candidate) => candidate.provider.supported_categories.includes(input.category))
    .sort((a, b) => a.priority - b.priority || a.provider.priority - b.provider.priority);
}

function applyBasisPoints(amountKobo: number, bps: number) {
  return Math.floor((amountKobo * bps) / 10_000);
}

export function resolveUtilityAmount(product: UtilityProductRow, requestedAmountKobo?: number): number {
  const amountKobo = product.amount_type === 'fixed' ? product.amount_kobo : requestedAmountKobo;
  if (typeof amountKobo !== 'number') {
    throw new ApiError('amount_kobo is required for variable utility products.', 400);
  }

  validateAmountKobo(amountKobo);

  if (product.min_amount_kobo !== null && amountKobo < product.min_amount_kobo) {
    throw new ApiError(`Minimum amount is ${product.min_amount_kobo} kobo.`, 400);
  }

  if (product.max_amount_kobo !== null && amountKobo > product.max_amount_kobo) {
    throw new ApiError(`Maximum amount is ${product.max_amount_kobo} kobo.`, 400);
  }

  return amountKobo;
}

export function calculateUtilityPricing(
  product: UtilityProductRow,
  mapping: UtilityProductMappingRow,
  requestedAmountKobo?: number,
): UtilityPricing {
  const amountKobo = resolveUtilityAmount(product, requestedAmountKobo);
  const markupKobo = applyBasisPoints(amountKobo, product.markup_bps);
  const convenienceFeeKobo = product.convenience_fee_kobo;
  const retailAmountKobo = amountKobo + markupKobo + convenienceFeeKobo;
  const discountBps = mapping.provider_discount_bps || product.provider_discount_bps;
  const providerCostKobo = mapping.provider_cost_kobo ?? amountKobo - applyBasisPoints(amountKobo, discountBps);
  const grossProfitKobo = retailAmountKobo - providerCostKobo;
  const grossMarginBps = retailAmountKobo > 0 ? Math.floor((grossProfitKobo * 10_000) / retailAmountKobo) : 0;

  if (providerCostKobo <= 0) {
    throw new ApiError('Provider cost must be positive.', 500);
  }

  return {
    amountKobo,
    convenienceFeeKobo,
    retailAmountKobo,
    providerCostKobo,
    grossProfitKobo,
    grossMarginBps,
  };
}

const ALGORITHM = 'aes-256-gcm';
const KEY_ID = 'utility-provider-credentials:v1';

export interface EncryptedProviderCredentials {
  encrypted: true;
  algorithm: typeof ALGORITHM;
  key_id: typeof KEY_ID;
  iv: string;
  tag: string;
  ciphertext: string;
  updated_at: string;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.UTILITY_PROVIDER_CREDENTIALS_KEY;
  if (!raw) {
    throw new ApiError('UTILITY_PROVIDER_CREDENTIALS_KEY is required before storing utility provider credentials.', 500);
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to passphrase hashing.
  }

  return createHash('sha256').update(raw).digest();
}

export function isEncryptedProviderCredentials(value: unknown): value is EncryptedProviderCredentials {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { encrypted?: unknown }).encrypted === true &&
    (value as { algorithm?: unknown }).algorithm === ALGORITHM,
  );
}

export function encryptProviderCredentials(credentials: Record<string, unknown>): EncryptedProviderCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const plaintext = JSON.stringify(credentials);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    encrypted: true,
    algorithm: ALGORITHM,
    key_id: KEY_ID,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updated_at: new Date().toISOString(),
  };
}

export function decryptProviderCredentials(envelope: EncryptedProviderCredentials): Record<string, unknown> {
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as Record<string, unknown>;
}

export function protectProviderCredentialsPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(payload, 'credentials')) return payload;

  const credentials = payload.credentials;
  if (credentials === null || credentials === undefined) return { ...payload, credentials: null };
  if (isEncryptedProviderCredentials(credentials)) return payload;
  if (typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new ApiError('Provider credentials must be an object.', 400);
  }

  return {
    ...payload,
    credentials: encryptProviderCredentials(credentials as Record<string, unknown>),
  };
}

export function providerCredentialsConfigured(row: Record<string, unknown>) {
  return Boolean(row.credentials);
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return '';
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));

  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\r\n');
}
