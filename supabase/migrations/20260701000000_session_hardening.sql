-- Session / refresh-token revocation lifecycle hardening + suspicious-login response.
-- ADDITIVE ONLY: no DROP, no RENAME, no type narrowing. Safe to re-run (IF NOT EXISTS).
-- Release Readiness §1: the two "[~] partial" items
--   - Full suspicious-activity response playbook (notify user, revoke sessions, forced reset)
--   - Full refresh-token/session revocation lifecycle hardening

BEGIN;

-- ── auth_sessions: rotation + revocation + device/ip fingerprint ──────────────
ALTER TABLE public.auth_sessions
  ADD COLUMN IF NOT EXISTS revoked_reason text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS rotation_counter integer NOT NULL DEFAULT 0,
  -- All sessions descended from a single login share a family id. Detecting reuse
  -- of a rotated (already-replaced) refresh token revokes the entire family.
  ADD COLUMN IF NOT EXISTS session_family_id uuid,
  -- Hash of the access token bound to this session, so the auth middleware can
  -- map an incoming bearer token to its session row and fail-closed when revoked.
  ADD COLUMN IF NOT EXISTS access_token_hash text,
  -- Hash of the immediately-previous refresh token (pre-rotation) for reuse detection.
  ADD COLUMN IF NOT EXISTS previous_token_hash text;

-- Backfill family id for any pre-existing rows (each legacy session is its own family).
UPDATE public.auth_sessions
  SET session_family_id = id
  WHERE session_family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON public.auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_hash
  ON public.auth_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_access_hash
  ON public.auth_sessions(access_token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family
  ON public.auth_sessions(session_family_id);

-- ── security_events: immutable record of suspicious-login / escalation actions ─
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  email text NOT NULL,
  event_type text NOT NULL,            -- new_device | new_ip | impossible_travel | failed_login_spike | token_reuse | forced_reset | sessions_revoked
  severity text NOT NULL DEFAULT 'high' CHECK (severity IN ('info','low','medium','high','critical')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-PII signal metadata (counts, distances, flags)
  ip_address inet,
  device_fingerprint text,
  user_agent text,
  action_taken text,                   -- notify | force_reverify | force_password_reset | revoke_sessions | none
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user ON public.security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events(created_at DESC);

-- ── platform_users: forced re-verification / forced reset flags (escalation) ──
ALTER TABLE public.platform_users
  ADD COLUMN IF NOT EXISTS force_password_reset boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS force_reverification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_security_event_at timestamptz;

COMMIT;
