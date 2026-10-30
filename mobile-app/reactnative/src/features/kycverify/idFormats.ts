// What Dojah expects for each government ID we can data-match, in one place.
// Mirrors the Go adapter's endpoint map (backend/internal/provider/dojah/
// mappers.go): those paths + query parameters ARE the contract Dojah enforces,
// so the form normalizes the number to that shape before the check is submitted.
//
// Pure and alias-free (only a type import) so it is unit-testable without the
// axios client or the RN runtime.
import type { IdType } from './types';

export interface IdFormat {
  /** Short label used in copy ("BVN", "NIN", …). */
  label: string;
  /** Exact digit count for numeric-only identifiers (BVN/NIN). */
  digits?: number;
  minLength: number;
  maxLength: number;
  keyboard: 'number-pad' | 'default';
  placeholder: string;
  /** A syntactically valid example — never a real person's identifier. */
  example: string;
  /** Dojah's input requirement, in plain language. */
  requirement: string;
  /** Dojah lookup path (no host — secrets and host stay server-side). */
  dojahPath: string;
  /** Query parameter Dojah expects the identifier in. */
  dojahParam: string;
}

export const ID_FORMATS: Record<IdType, IdFormat> = {
  BVN: {
    label: 'BVN',
    digits: 11,
    minLength: 11,
    maxLength: 11,
    keyboard: 'number-pad',
    placeholder: '11-digit BVN',
    example: '22212345678',
    requirement:
      'Exactly 11 digits, no spaces — the number on your BVN slip or from *901#. Dojah matches it against the bank-verification database.',
    dojahPath: '/api/v1/kyc/bvn/full',
    dojahParam: 'bvn',
  },
  NIN: {
    label: 'NIN',
    digits: 11,
    minLength: 11,
    maxLength: 11,
    keyboard: 'number-pad',
    placeholder: '11-digit NIN',
    example: '70123456789',
    requirement:
      'Exactly 11 digits, no spaces — the National Identity Number on your NIN slip. Dojah matches it against the national identity database.',
    dojahPath: '/api/v1/kyc/nin',
    dojahParam: 'nin',
  },
  PASSPORT: {
    label: 'Passport',
    minLength: 6,
    maxLength: 12,
    keyboard: 'default',
    placeholder: 'Passport number',
    example: 'A12345678',
    requirement:
      'The passport number exactly as printed on the data page: letters and numbers only, 6–12 characters, no spaces or dashes.',
    dojahPath: '/api/v1/kyc/passport',
    dojahParam: 'passport_number',
  },
  DRIVERS_LICENSE: {
    label: "Driver's licence",
    minLength: 6,
    maxLength: 20,
    keyboard: 'default',
    placeholder: 'Licence number',
    example: 'ABC123456789',
    requirement:
      'The licence number exactly as printed on the card: letters and numbers only, 6–20 characters, no spaces or dashes.',
    dojahPath: '/api/v1/kyc/dl',
    dojahParam: 'license_number',
  },
  VOTERS_CARD: {
    label: "Voter's card VIN",
    minLength: 10,
    maxLength: 25,
    keyboard: 'default',
    placeholder: 'Voter VIN',
    example: '90F5B1234567890123456',
    requirement:
      "The Voter Identification Number (VIN) printed on your voter's card: letters and numbers only, 10–25 characters, no spaces.",
    dojahPath: '/api/v1/kyc/pvc',
    dojahParam: 'vin',
  },
};

const isNumeric = (f: IdFormat): boolean => typeof f.digits === 'number';

/**
 * The value actually submitted: separators and stray characters removed, letters
 * uppercased, capped at the format's maximum length. Dojah receives exactly this.
 */
export function normalizeIdNumber(idType: IdType, raw: string): string {
  const f = ID_FORMATS[idType];
  if (isNumeric(f)) {
    return raw.replace(/\D/g, '').slice(0, f.maxLength);
  }
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, f.maxLength);
}

export interface IdValidation {
  ok: boolean;
  /** Message to show while the user is typing; undefined until something is wrong. */
  error?: string;
  normalized: string;
  length: number;
}

/** Validate against Dojah's expected shape; an empty value is "not ready" but not an error. */
export function validateIdNumber(idType: IdType, raw: string): IdValidation {
  const f = ID_FORMATS[idType];
  const normalized = normalizeIdNumber(idType, raw);
  const length = normalized.length;
  if (length === 0) {
    return { ok: false, normalized, length };
  }
  if (isNumeric(f)) {
    if (length !== f.digits) {
      return {
        ok: false,
        error: `Your ${f.label} is ${f.digits} digits — you've entered ${length}.`,
        normalized,
        length,
      };
    }
    return { ok: true, normalized, length };
  }
  if (length < f.minLength) {
    return {
      ok: false,
      error: `Enter the full ${f.label} number (at least ${f.minLength} characters).`,
      normalized,
      length,
    };
  }
  return { ok: true, normalized, length };
}

/** Grouped form for display/confirmation only — never what we submit. */
export function formatIdNumberForDisplay(idType: IdType, raw: string): string {
  const f = ID_FORMATS[idType];
  const value = normalizeIdNumber(idType, raw);
  if (!isNumeric(f)) return value;
  return value.replace(/(.{3})/g, '$1 ').trim();
}

/** Keep the head and tail, mask the middle — safe to show in a payload preview. */
export function maskIdNumber(raw: string): string {
  const value = raw.trim();
  if (value.length <= 4) return '•'.repeat(value.length);
  return value.slice(0, 3) + '•'.repeat(value.length - 5) + value.slice(-2);
}

export interface DojahLookup {
  provider: string;
  method: 'GET';
  path: string;
  param: string;
  /** Masked identifier as it appears in the query string. */
  value: string;
  /** Human-readable request line for the on-screen "what we send" card. */
  requestLine: string;
}

/** The exact Dojah request the backend will make for this identifier. */
export function dojahLookup(idType: IdType, raw: string): DojahLookup {
  const f = ID_FORMATS[idType];
  const value = maskIdNumber(normalizeIdNumber(idType, raw));
  return {
    provider: 'Dojah',
    method: 'GET',
    path: f.dojahPath,
    param: f.dojahParam,
    value,
    requestLine: `GET ${f.dojahPath}?${f.dojahParam}=${encodeURIComponent(value)}`,
  };
}
