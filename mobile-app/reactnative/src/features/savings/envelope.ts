// Response-envelope helpers for the Go savings API.
//
// Every success response from `backend/internal/savings/handler.go` is an
// envelope keyed by entity name, never a bare payload:
//
//   GET  /vaults          → { success: true, vaults: [...] }
//   GET  /vaults/:id      → { success: true, vault: {...}, balance_kobo: 1234 }
//   GET  /circles/:id     → { success: true, circle: {...}, members: [...] }
//   GET  /targets/:id     → { success: true, target: {...}, members: [...], balance_kobo: 1234 }
//   POST /vaults/:id/deposit → { success: true, balance_kobo: 1234 }
//
// `body()` deliberately returns that envelope UNTOUCHED, because the mutation
// callers read `balance_kobo` straight off it. Anything that wants the entity
// or the list must therefore pull it out BY KEY.
//
// Skipping that step does not fail loudly: `Array.isArray(envelope)` is false,
// so a list read degrades to `[]` and the screen renders empty with no error —
// which is exactly how the live savings path stayed silently broken. Prefer
// these helpers over hand-rolled property access at call sites.

/** Axios-style response wrapper. */
type Res = { data: unknown };

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The response body, after the optional `{ data }` indirection some callers
 * still send. Returns the envelope itself — not the entity inside it.
 */
export function body(res: Res): any {
  const payload = res?.data;
  if (isPlainObject(payload) && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

/**
 * Extract a list from `{ success, <key>: [...] }`.
 * Tolerates a bare array (older/alternate shapes) and never throws — an
 * unrecognised shape yields `[]`, matching the previous contract.
 */
export function list(res: Res, key: string): any[] {
  const payload = body(res);
  const value = isPlainObject(payload) ? payload[key] : payload;
  return Array.isArray(value) ? value : [];
}

/**
 * Extract a single entity from `{ success, <key>: {...} }`.
 * Falls through to the body when the key is absent, so a handler that starts
 * returning the bare entity keeps working.
 */
export function entity(res: Res, key: string): any {
  const payload = body(res);
  if (isPlainObject(payload) && key in payload) return payload[key];
  return payload;
}

/**
 * `GET /vaults/:id` → `{ success, vault, balance_kobo }`.
 * The Go `Vault` struct carries NO balance field, so the envelope's
 * `balance_kobo` is the only source of a vault's balance — fold it in.
 */
export function vaultDetail(res: Res): any {
  const payload = body(res);
  const vault = isPlainObject(payload) ? payload.vault : null;
  if (!vault) return payload;
  return { ...vault, balance_kobo: payload.balance_kobo ?? vault.balance_kobo };
}

/**
 * Display status for a vault, from Go's TWO separate fields:
 *   state = OPEN | MATURED | CLOSED   (lifecycle)
 *   kind  = FLEX | LOCK               (product)
 *
 * These are easy to conflate: the client previously tested `state === 'LOCK'`,
 * which can never be true, so a LOCK vault never reported as locked and every
 * lock-dependent branch took the unlocked path.
 *
 * Lifecycle wins when the vault has moved past OPEN; otherwise the kind decides.
 */
export function vaultStatus(state?: string, kind?: string): string {
  const s = (state ?? '').toUpperCase();
  if (s === 'MATURED' || s === 'CLOSED') return s;
  return (kind ?? '').toUpperCase() === 'LOCK' ? 'LOCKED' : s || 'OPEN';
}

/**
 * `GET /summary` → `{ success, summary: { vault_count, vault_balance_kobo,
 * circle_count, target_count, target_balance_kobo, total_saved_kobo } }`,
 * mapped to the camelCase `SavingsSummary`.
 *
 * This aggregate cannot be derived client-side: list rows carry no balances,
 * so summing them always yields 0. The Go side computes it from the ledger.
 */
export function summary(res: Res): {
  totalSavedKobo: number;
  vaultCount: number;
  circleCount: number;
  targetCount: number;
} {
  const s = entity(res, 'summary') ?? {};
  return {
    totalSavedKobo: s.total_saved_kobo ?? 0,
    vaultCount: s.vault_count ?? 0,
    circleCount: s.circle_count ?? 0,
    targetCount: s.target_count ?? 0,
  };
}

/**
 * `GET /circles/:id` → `{ success, circle, members }`.
 * `circleFromBackend` reads `raw.members`, so members must be folded into the
 * circle rather than left beside it on the envelope.
 */
export function circleDetail(res: Res): any {
  const payload = body(res);
  const circle = isPlainObject(payload) ? payload.circle : null;
  if (!circle) return payload;
  return { ...circle, members: payload.members ?? circle.members };
}

/**
 * `GET /targets/:id` → `{ success, target, members, balance_kobo }`.
 * The Go `GroupTarget` struct has no `saved_kobo`, so the envelope's
 * `balance_kobo` is the authoritative saved amount; `targetFromBackend` reads
 * `raw.saved_kobo` and `raw.contributors`.
 */
export function targetDetail(res: Res): any {
  const payload = body(res);
  const target = isPlainObject(payload) ? payload.target : null;
  if (!target) return payload;
  return {
    ...target,
    contributors: payload.members ?? target.contributors,
    saved_kobo: payload.balance_kobo ?? target.saved_kobo,
  };
}
