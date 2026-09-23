// ── Secure random helpers ─────────────────────────────────────────────────────
// Math.random() is not cryptographically secure and must not back anything
// that looks like an identifier, token, or code — even a mock/demo one, since
// static analysis (and a future real implementation copy-pasting the mock)
// can't tell "de-dup key" from "session token" apart from the source alone.
// Prefers globalThis.crypto (available on web and modern Hermes/Expo builds);
// falls back to Math.random() only where crypto is genuinely unavailable —
// same fallback shape already used by the newIdempotencyKey() helpers
// (e.g. src/features/pharmacymerchant/api.ts).

function hasCrypto(): boolean {
  return typeof globalThis.crypto?.getRandomValues === 'function';
}

/** A crypto-secure UUID, falling back to a Math.random()-based id when unavailable. */
export function secureRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** A crypto-secure integer in [min, max] inclusive, falling back to Math.random(). */
export function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  if (hasCrypto()) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  return min + Math.floor(Math.random() * range);
}

/** A crypto-secure zero-padded numeric string of the given length (e.g. a mock CVV/account digit run). */
export function secureRandomDigits(length: number): string {
  const max = 10 ** length - 1;
  return String(secureRandomInt(0, max)).padStart(length, '0');
}
