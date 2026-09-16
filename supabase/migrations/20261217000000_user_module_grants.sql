-- Per-user module access: a "general" tier of modules everyone gets, plus explicit
-- admin grants for everything else (additive-only).
--
-- THE PROBLEM: ~94% of profiles sit at KYC tier 0, so almost every registered user is
-- limited by default. Support needs a way to open a specific module for a specific user
-- who has not completed KYC, without that becoming a backdoor around AML controls.
--
-- THE BOUNDARY, and it is the important part of this migration:
--   * a grant controls MODULE ACCESS — whether a user may open and use a module's
--     screens and non-money features;
--   * a grant does NOT touch MONEY LIMITS. Wallet debits, transfers and escrow keep
--     obeying finance/tiers (Tier 0 still means no wallet). Nothing here is read by
--     EnforceWalletDebitLimit, and nothing here should ever be.
-- Keeping those separate is what lets a support agent hand out module access without
-- making a compliance decision.

-- ─── access level on the module itself ────────────────────────────────────────
-- 'general'    → any signed-in user may use it (profile, support, browse surfaces)
-- 'restricted' → needs a completed KYC tier OR an explicit admin grant
--
-- Defaults to 'general' deliberately. Every module is reachable by every user TODAY, so
-- defaulting to 'restricted' would lock ~10k users out of the app on deploy. Restricting
-- a module is therefore an explicit, auditable act in the admin console — the same
-- "align the recorded state with observed behaviour first" rule the registry mount used.
ALTER TABLE public.platform_modules
    ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'general'
    CHECK (access_level IN ('general', 'restricted'));

-- ─── per-user grants ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_module_grants (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    module_key  TEXT NOT NULL REFERENCES public.platform_modules(key) ON DELETE CASCADE,
    -- Nullable = permanent. An expiry is how a temporary support grant closes itself
    -- instead of quietly becoming permanent access nobody remembers issuing.
    expires_at  TIMESTAMPTZ,
    -- Revocation is a soft delete so the audit trail survives: "who had access when"
    -- is the question asked after an incident, and a hard DELETE cannot answer it.
    revoked_at  TIMESTAMPTZ,
    granted_by  UUID REFERENCES auth.users(id),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, module_key)
);

-- The hot read is "everything this user is entitled to", on every app cold start.
CREATE INDEX IF NOT EXISTS user_module_grants_user_idx
    ON public.user_module_grants (user_id) WHERE revoked_at IS NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Deny-all: grants are read and written by the Go service over a direct pgx
-- connection as the table owner, which bypasses RLS. No client policy is granted —
-- a user must not be able to read (or infer) other users' entitlements, and must
-- certainly not write their own.
ALTER TABLE public.user_module_grants ENABLE ROW LEVEL SECURITY;

-- ─── phone sign-in lookup ─────────────────────────────────────────────────────
-- Sign-in accepts a phone OR an email. Stored phones are not normalised (one row is
-- '8159491618' with no country code or leading zero, while apps submit '08159491618'
-- or '+2348159491618'), so the lookup compares the last 10 digits. This functional
-- index keeps that comparison from becoming a sequential scan of every profile on
-- every phone sign-in.
CREATE INDEX IF NOT EXISTS user_profiles_phone_nsn_idx
    ON public.user_profiles ((right(regexp_replace(COALESCE(phone,''), '\D', '', 'g'), 10)))
    WHERE phone IS NOT NULL AND phone <> '';
