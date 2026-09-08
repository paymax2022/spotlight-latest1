/**
 * OTP code shape for the web app.
 *
 * Twin of mobile-app/reactnative/src/features/auth/otp.ts. The two are duplicated
 * deliberately: this repo has no shared package (see CLAUDE.md — no packages/
 * directory), and the alternative is a cross-app import that neither build
 * resolves. Keep them in step; the rules below are identical on both sides.
 *
 * The length must equal the Supabase project's mailer_otp_length — staging and
 * local issue 6, PRODUCTION issues 8. See docs/audit/USER_MANAGEMENT_AUDIT.md B2.
 */

export const OTP_MIN = 4;
export const OTP_MAX = 10;
export const OTP_DEFAULT = 6;

export function resolveOtpLength(raw?: string | number | null): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return OTP_DEFAULT;
  if (n < OTP_MIN || n > OTP_MAX) return OTP_DEFAULT;
  return n;
}

export function otpLength(): number {
  // Must be referenced as a full literal, not process.env[key] — Next inlines
  // NEXT_PUBLIC_* at build time only when it can see the whole expression.
  return resolveOtpLength(process.env.NEXT_PUBLIC_OTP_LENGTH);
}

/**
 * Spreads typed or pasted input across the boxes from `index` onward.
 * Browser autofill and clipboard both deliver the whole code into one field; a
 * one-char-per-box handler silently truncates it, so the code looks entered and
 * verification fails with nothing on screen to explain why.
 * Non-digits are stripped: autofill often supplies "Your code is 123456".
 */
export function distributeOtpInput(current: string[], index: number, text: string): string[] {
  const digits = (text ?? '').replace(/\D/g, '');
  const next = [...current];
  if (digits.length <= 1) {
    next[index] = digits;
    return next;
  }
  for (let i = 0; i < digits.length && index + i < next.length; i++) next[index + i] = digits[i];
  return next;
}

/** The box that should hold focus after `distributeOtpInput`. */
export function nextOtpFocus(filled: string[], from: number): number {
  const firstEmpty = filled.findIndex((d, i) => i >= from && !d);
  return firstEmpty === -1 ? filled.length - 1 : firstEmpty;
}
