import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  isEncryptedProviderCredentials,
  protectProviderCredentialsPayload,
} from '@/src/server/utility/credentials';

const OLD_KEY = process.env.UTILITY_PROVIDER_CREDENTIALS_KEY;

describe('utility provider credential encryption', () => {
  beforeEach(() => {
    process.env.UTILITY_PROVIDER_CREDENTIALS_KEY = 'test-utility-provider-credential-key';
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.UTILITY_PROVIDER_CREDENTIALS_KEY;
    else process.env.UTILITY_PROVIDER_CREDENTIALS_KEY = OLD_KEY;
  });

  it('encrypts and decrypts provider credentials', () => {
    const encrypted = encryptProviderCredentials({
      apiKey: 'secret-api-key',
      merchantId: 'merchant-001',
    });

    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.ciphertext).not.toContain('secret-api-key');
    expect(decryptProviderCredentials(encrypted)).toEqual({
      apiKey: 'secret-api-key',
      merchantId: 'merchant-001',
    });
  });

  it('protects provider payload credentials before persistence', () => {
    const payload = protectProviderCredentialsPayload({
      name: 'Provider A',
      credentials: { token: 'secret-token' },
    });

    expect(payload.name).toBe('Provider A');
    expect(isEncryptedProviderCredentials(payload.credentials)).toBe(true);
  });

  it('rejects credentials when the encryption key is missing', () => {
    delete process.env.UTILITY_PROVIDER_CREDENTIALS_KEY;

    expect(() => protectProviderCredentialsPayload({
      credentials: { token: 'secret-token' },
    })).toThrow(/UTILITY_PROVIDER_CREDENTIALS_KEY/);
  });
});
