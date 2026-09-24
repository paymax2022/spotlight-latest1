// ── Paymax Mobility — error-kind classification ──────────────────────────────
// A real connectivity drop (no HTTP response reached the client — DNS/timeout/
// no network) is "offline"; anything the server actually answered (404/5xx,
// a validation error, a malformed body) is a backend failure, not the user's
// network, and must not be shown as "You appear to be offline" — that copy
// sends the user chasing their own connection for a bug that is on the server.

/** Classifies an axios-style error for MobilityEdgeState's `kind` prop. */
export const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';
