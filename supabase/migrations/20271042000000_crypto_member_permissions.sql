-- Grant crypto.view / crypto.trade to the default MEMBER roles.
--
-- 20260815001600_crypto.sql seeded crypto.view, crypto.trade and crypto.admin but
-- attached ALL THREE only to super-admin and system-admin. Every crypto member
-- route is guarded by RequirePermission(crypto.view | crypto.trade), so an ordinary
-- member got 403 "forbidden" on every one of them - including the swap pipeline
-- (POST /api/v1/crypto/swaps/quote) - no matter which feature flags were on.
-- Found by the local swap end-to-end: a fresh registered member was refused at the
-- permission gate before any quote, PIN or ledger code ran.
--
-- This is the same shape as 20260903000000_connect_discovery_boosts.sql: member
-- permissions go to the default member roles ('registered-user', the default
-- authenticated role, and 'verified-user').
--
-- crypto.admin is deliberately NOT granted - it stays admin-only.
--
-- This opens only the DOORWAY. It does not by itself let anyone trade:
--   * routes stay unmounted unless FEATURE_CRYPTO_ENABLED (and, for the swap
--     pipeline, FEATURE_CRYPTO_SWAPS_ENABLED + a Quidax webhook secret) are on;
--     production has them off, and compliance sign-off is still open;
--   * every swap still passes the KYC tier gate (minimum Tier 1) and the
--     transaction-PIN second factor, and the per-user rate limits.
--
-- Additive and idempotent: ON CONFLICT DO NOTHING, no deletes, no renames. A
-- missing role or permission yields zero rows rather than an error, so replaying
-- the chain on a database without these roles still succeeds.

BEGIN;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('registered-user', 'verified-user')
  AND p.slug IN ('crypto.view', 'crypto.trade')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
