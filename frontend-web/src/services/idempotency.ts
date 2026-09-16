// Shared Idempotency-Key helper for admin money mutations.
//
// House iron rule (CLAUDE.md): every money mutation MUST carry an Idempotency-Key;
// the backend fail-closes without one. Admin money/state-transition operations are
// one-shot (you reverse a transfer / decide a withdrawal / unlock a vault once), so
// the key is derived from the OPERATION IDENTITY rather than a random value. That
// makes a double-click or retry dedupe at the backend instead of double-posting,
// while a genuinely distinct operation gets a distinct key.
//
// Pass the stable parts that identify the operation, most-general first, e.g.
//   operationKey('transfer', 'reverse', transferId)
//   operationKey('crypto:withdrawal-decision', withdrawalId)
//   operationKey(method, path)            // for a generic request helper

const HEADER_SAFE = /[^A-Za-z0-9._:/-]/g;

export function operationKey(...parts: Array<string | number>): string {
  const raw = parts
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(':')
    .replace(HEADER_SAFE, '-');
  return `admin:${raw}`.slice(0, 200);
}
