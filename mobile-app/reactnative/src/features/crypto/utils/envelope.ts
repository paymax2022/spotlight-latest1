// Unwraps the Go API's success-envelope into the bare payload.
//
// The legacy crypto handlers (backend/internal/crypto) wrap every 2xx body under
// a NAMED key — { success: true, order }, { success: true, portfolio }, { success,
// assets }, { success, swap }, … — not under `data`. The client must therefore
// unwrap the single payload key, not just a `data` key, or a mockless (staging/
// prod) build receives { success, <key> } where it expects the payload. Mock
// responses return the raw payload (no `success` flag) and must pass through
// untouched.
//
// Kept pure (no runtime imports) so it is unit-testable in isolation.

/**
 * Return the payload carried by a Go success-envelope:
 *  - { success: boolean, <oneKey>: payload }  -> payload   (the named-key case)
 *  - { success: boolean, data: payload }       -> payload   (handled by the above)
 *  - { data: payload }                         -> payload   (explicit data envelope)
 *  - anything else (raw mock object/array, primitive, null, or an ambiguous
 *    multi-key envelope) -> returned unchanged.
 */
export function unwrapEnvelope<T>(body: unknown): T {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    // A Go success-envelope: unwrap its single payload key (ignoring `message`).
    if (typeof b.success === 'boolean') {
      const keys = Object.keys(b).filter((k) => k !== 'success' && k !== 'message');
      if (keys.length === 1) return b[keys[0]] as T;
      // 0 keys (success-only) or >1 (ambiguous, e.g. paginated) — leave as-is.
    } else if ('data' in b) {
      // A bare { data } envelope with no success flag.
      return (b as { data: T }).data;
    }
  }
  return body as T;
}
