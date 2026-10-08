// Idempotency keys for money mutations whose call sites mint the key inside the
// API function. A key minted per HTTP attempt does not protect the one case it
// exists for: the request times out (or the connection drops) after the server
// committed, the user retries, and the retry carries a fresh key — a second
// debit. `withIntentKey` keeps the key for the same intent across that retry.
//
// The key is dropped as soon as the outcome is KNOWN: on success, and on any
// response the server actually sent below 500 (validation, wrong PIN,
// insufficient funds). Only an ambiguous failure — no response at all, or a
// 5xx — keeps it, so a deliberate second transfer of the same amount to the
// same person is never mistaken for a replay.

const TTL_MS = 15 * 60_000;
const pending = new Map<string, { key: string; at: number }>();

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
}

function isAmbiguousFailure(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status == null || status >= 500;
}

/**
 * Run `send` with an idempotency key that is stable for `intent` until its
 * outcome is known.
 *
 * @param scope   the operation, e.g. 'transfer:wallet'
 * @param intent  what the user asked for (recipient, amount…) — never the PIN
 */
export async function withIntentKey<T>(
  scope: string,
  intent: unknown,
  send: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const id = `${scope}:${stable(intent)}`;
  const now = Date.now();
  const held = pending.get(id);
  const key = held && now - held.at < TTL_MS ? held.key : `idem_${now}_${Math.random().toString(36).substring(2, 12)}`;
  pending.set(id, { key, at: held && key === held.key ? held.at : now });
  try {
    const result = await send(key);
    pending.delete(id);
    return result;
  } catch (error) {
    if (!isAmbiguousFailure(error)) pending.delete(id);
    throw error;
  }
}

/** Drop every held key (sign-out, tests). */
export function clearIntentKeys(): void {
  pending.clear();
}
