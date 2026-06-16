import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiError } from '@/src/lib/api/responses';

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
