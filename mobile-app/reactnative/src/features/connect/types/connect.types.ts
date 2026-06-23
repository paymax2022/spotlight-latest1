// Paymax Connect — mobile types (Phase 0 shell).

// Backend-owned config exposed to mobile (public subset only). Values are kept
// loosely typed because the backend owns the schema; mobile must never hard-code
// these flags/weights/limits. See docs/prd/dating/architecture.md §26.4.
export type ConnectConfig = Record<string, unknown>;
