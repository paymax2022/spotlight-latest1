/**
 * Deterministic test OTP (dev/E2E only).
 *
 * Backend: FEATURE_TEST_OTP_DETERMINISTIC_ENABLED=true with APP_ENV in
 * development/dev/local/test. For phones starting +234999 the OTP is always
 * 123456 and no SMS is sent; any other phone still gets a real code.
 * The backend refuses this mode on staging/production. See
 * backend/internal/otp/test_mode.go.
 */
export const TEST_PHONE_PREFIX = '+234999';
export const DETERMINISTIC_OTP = '123456';

export function getDeterministicOTP(): string {
  return DETERMINISTIC_OTP;
}

/** Returns a unique reserved-range phone (E.164) so each test gets a fresh OTP budget. */
export function issueDeterministicOTPFor(seed: string | number = Date.now()): { phone: string; otp: string } {
  const digits = String(seed).replace(/\D/g, '').slice(-7).padStart(7, '0');
  return { phone: `${TEST_PHONE_PREFIX}${digits}`, otp: DETERMINISTIC_OTP };
}
