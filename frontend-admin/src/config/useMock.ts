// Central resolver for admin service mock mode — FAIL-CLOSED to live in production.
//
// The problem this fixes: services historically resolved their mock flag as
//   const USE_MOCK = (process.env.NEXT_PUBLIC_<MODULE>_USE_MOCK ?? 'true') !== 'false';
// i.e. MOCK unless someone remembered to set the flag to 'false'. That fails OPEN —
// a forgotten flag silently ships fabricated data to a fintech operator.
//
// resolveUseMock inverts the DEFAULT by environment:
//   • Development (NODE_ENV !== 'production'): default MOCK when the flag is unset —
//     convenient local work without every backend running.
//   • Production (NODE_ENV === 'production'): default LIVE when the flag is unset —
//     a service never silently ships mock. A module that genuinely has no backend
//     yet must OPT IN by setting its flag to 'true'. scripts/check-mock-flags.mjs
//     surfaces every such opt-in and (in --strict/CI) fails the build unless the
//     module is on its documented allowlist.
//
// Explicit 'true' / 'false' always win, in every environment.
//
// Adoption: migrate a service from its inline `?? 'true'` check to
//   const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_<MODULE>_USE_MOCK);
// once its backend is confirmed deployed, then set NEXT_PUBLIC_<MODULE>_USE_MOCK=false in
// prod (or leave unset — it now defaults live) and drop it from the allowlist.
export function resolveUseMock(rawFlag: string | undefined | null): boolean {
  const v = typeof rawFlag === 'string' ? rawFlag.trim().toLowerCase() : '';
  if (v === 'false') return false; // explicit LIVE
  if (v === 'true') return true; // explicit MOCK
  // Unset: mock in dev, live in prod.
  return process.env.NODE_ENV !== 'production';
}
