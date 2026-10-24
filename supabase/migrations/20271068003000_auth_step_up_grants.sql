-- ESTD-D014 (S1, EST-UAT-0385): platform step-up verification for privileged
-- actions. Design: docs/adr/ADR-PR<pr-number>-step-up-and-support-impersonation.md
-- (cited as ADR-PR<pr-number> until adr-assign.yml numbers it on merge).
--
-- estate_member_settings.two_factor_enabled was an advisory preference that
-- nothing enforced. A step-up grant is the proof that the caller completed a
-- fresh second-factor challenge (email OTP, purpose 'step_up') a few minutes
-- ago, bound to BOTH the user and the exact bearer token (session) it was
-- completed in. backend/internal/stepup reads it; nothing else writes it.
--
-- Raw tokens are never stored — access_token_hash is the same sha256 hex
-- services.HashToken produces for auth_sessions.
--
-- Additive-only: one new table + indexes. Backend-only (service role), so RLS is
-- ENABLEd with no policy = deny-all to anon/authenticated (same doctrine as
-- 20271067000020_rls_backend_only_tables.sql).

CREATE TABLE IF NOT EXISTS public.auth_step_up_grants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  access_token_hash text        NOT NULL CHECK (length(access_token_hash) = 64),
  method            text        NOT NULL DEFAULT 'email_otp' CHECK (method IN ('email_otp')),
  ip_address        text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.auth_step_up_grants IS
  'Short-lived step-up (re-verification) grants bound to user + access-token hash. ESTD-D014 / ADR-PR<pr-number>.';

-- Hot path: RequireStepUp looks up the newest grant for (user, token).
CREATE INDEX IF NOT EXISTS auth_step_up_grants_user_token_idx
  ON public.auth_step_up_grants (user_id, access_token_hash, expires_at DESC);

-- Sweep path.
CREATE INDEX IF NOT EXISTS auth_step_up_grants_expires_idx
  ON public.auth_step_up_grants (expires_at);

ALTER TABLE public.auth_step_up_grants ENABLE ROW LEVEL SECURITY;
