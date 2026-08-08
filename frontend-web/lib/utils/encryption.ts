/**
 * Client-side encryption utilities for sensitive exam data
 * Uses Web Crypto API for AES-256-GCM encryption
 * Optional: transparent encryption for IndexedDB
 */

/**
 * Generate a cryptographic key from a password
 * Uses PBKDF2 with 100,000 iterations for key derivation
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param data - Data to encrypt (string or object)
 * @param password - Encryption password
 * @returns Encrypted data with salt and IV as base64
 */
export async function encryptData(
  data: string | object,
  password: string
): Promise<string> {
  try {
    // Convert data to JSON string if object
    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);

    // Generate random salt (16 bytes) and IV (12 bytes)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive encryption key from password
    const key = await deriveKey(password, salt);

    // Encrypt data
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    );

    // Combine salt, IV, and encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data encrypted with encryptData()
 *
 * @param encryptedData - Base64 encrypted data
 * @param password - Encryption password
 * @param asObject - Parse result as JSON
 * @returns Decrypted plaintext or object
 */
export async function decryptData<T = string>(
  encryptedData: string,
  password: string,
  asObject: boolean = false
): Promise<T | string> {
  try {
    // Convert from base64
    const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

    // Extract salt, IV, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    // Derive key from password and salt
    const key = await deriveKey(password, salt);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    // Convert to string
    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decrypted);

    // Parse as JSON if requested
    if (asObject) {
      return JSON.parse(plaintext) as T;
    }

    return plaintext as T;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value using SHA-256
 * Useful for checksums and verification
 */
export async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random secure token
 * Useful for session tokens, nonces, etc.
 */
export function generateToken(length: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encrypt sensitive exam answers for local storage
 * Transparent encryption/decryption
 */
export class EncryptedExamStorage {
  private password: string;

  constructor(userId: string, attemptId: string) {
    // Derive password from userId + attemptId for reproducibility
    this.password = `exam-${userId}-${attemptId}`;
  }

  async encryptAnswers(answers: Record<number, string>): Promise<string> {
    return encryptData(answers, this.password);
  }

  async decryptAnswers(encrypted: string): Promise<Record<number, string>> {
    return decryptData(encrypted, this.password, true);
  }

  async encryptProgress(progress: {
    answers: Record<number, string>;
    flagged: number[];
    currentQuestion: number;
    timeSpent: number;
  }): Promise<string> {
    return encryptData(progress, this.password);
  }

  async decryptProgress(encrypted: string): Promise<{
    answers: Record<number, string>;
    flagged: number[];
    currentQuestion: number;
    timeSpent: number;
  }> {
    return decryptData<{
      answers: Record<number, string>;
      flagged: number[];
      currentQuestion: number;
      timeSpent: number;
    }>(encrypted, this.password, true) as Promise<{
      answers: Record<number, string>;
      flagged: number[];
      currentQuestion: number;
      timeSpent: number;
    }>;
  }
}

/**
 * Key rotation for encryption
 * Useful when user password changes
 */
export async function rotateEncryption(
  encryptedData: string,
  oldPassword: string,
  newPassword: string
): Promise<string> {
  const plaintext = await decryptData(encryptedData, oldPassword);
  return encryptData(plaintext, newPassword);
}

/**
 * Verify encryption password without decryption
 * Stores hash of password for verification
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computedHash = await hashData(password);
  return computedHash === hash;
}

/**
 * Create password hash for storage
 * Never store plaintext passwords
 */
export async function hashPassword(password: string): Promise<string> {
  return hashData(`password-hash-${password}`);
}
