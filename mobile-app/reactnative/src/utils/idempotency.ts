import { useCallback, useRef, useState } from 'react';

export function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

/**
 * Returns an idempotency key that is stable across retries of the SAME logical
 * operation.
 *
 * A key minted per HTTP attempt is useless: if a request times out client-side
 * while the server actually completed the debit, the retry carries a new key,
 * the server sees an unrelated request, and the user is charged twice. The key
 * must therefore identify the operation the user intended — one "send this
 * gift" — not the attempt.
 *
 * Usage: mint once where the user commits to the action (the confirm screen),
 * pass `key` to every attempt, and call `reset()` only after a success, so the
 * next distinct operation gets a fresh key.
 *
 *   const { key, reset } = useIdempotencyKey();
 *   send.mutate({ ...input, idempotencyKey: key }, { onSuccess: () => { reset(); … } });
 *
 * On a retry the server recognises the replayed key and answers 409 rather than
 * posting a second journal.
 */
export function useIdempotencyKey(): { key: string; reset: () => void } {
  const [key, setKey] = useState(generateIdempotencyKey);
  const reset = useCallback(() => setKey(generateIdempotencyKey()), []);
  return { key, reset };
}

/**
 * Ref-based variant for callers outside React state (or where a re-render on
 * reset is unwanted). Same contract: stable until explicitly reset.
 */
export function useIdempotencyKeyRef(): { current: () => string; reset: () => void } {
  const ref = useRef(generateIdempotencyKey());
  const current = useCallback(() => ref.current, []);
  const reset = useCallback(() => { ref.current = generateIdempotencyKey(); }, []);
  return { current, reset };
}
