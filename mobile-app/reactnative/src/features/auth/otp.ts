/**
 * OTP code shape — one source of truth for how many digits a code has.
 *
 * The screen hardcoded 6 (six boxes, and a literal "Enter all 6 digits"), while
 * Supabase Auth's mailer_otp_length is per-project: staging and local issue 6 and
 * PRODUCTION issues 8. A production user therefore received an 8-digit code and
 * could not physically enter it — invisible in dev and staging, which both send 6.
 *
 * The length now comes from configuration, so it can be matched to whatever the
 * project issues without another release. It must equal the project's
 * mailer_otp_length; they are two halves of one setting.
 */

export const OTP_MIN = 4;
export const OTP_MAX = 10;
export const OTP_DEFAULT = 6;

/**
 * Resolves the expected code length. Anything unparseable or out of range falls
 * back to the default rather than rendering zero boxes or a hundred.
 */
export function resolveOtpLength(raw?: string | number | null): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return OTP_DEFAULT;
  if (n < OTP_MIN || n > OTP_MAX) return OTP_DEFAULT;
  return n;
}

export function otpLength(): number {
  return resolveOtpLength(process.env.EXPO_PUBLIC_OTP_LENGTH);
}

/**
 * Spreads typed or pasted input across the boxes from `index` onward.
 *
 * Autofill and clipboard both deliver the whole code into a single box, which the
 * old one-char-per-box handler silently truncated to its last character — the
 * code looked entered and verification failed with no explanation.
 *
 * Non-digits are stripped: iOS autofill often supplies "Your code is 123456".
 */
export function distributeOtpInput(current: string[], index: number, text: string): string[] {
  const digits = (text ?? '').replace(/\D/g, '');
  const next = [...current];

  if (digits.length <= 1) {
    next[index] = digits;
    return next;
  }
  for (let i = 0; i < digits.length && index + i < next.length; i++) {
    next[index + i] = digits[i];
  }
  return next;
}

/** The box that should hold focus after `distributeOtpInput`. */
export function nextOtpFocus(filled: string[], from: number): number {
  const firstEmpty = filled.findIndex((d, i) => i >= from && !d);
  return firstEmpty === -1 ? filled.length - 1 : firstEmpty;
}
