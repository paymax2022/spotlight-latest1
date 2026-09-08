-- Stays hotelier extranet: email-based staff invites.
--
-- inviteStaff(name, email, role) needs to onboard someone who does not yet
-- hold a Spotlight platform account — stays_hotelier_profile only grants a
-- role to an EXISTING auth.users id, so there was no path for that case.
-- This table tracks the pending invite between "email sent" and "grant
-- applied"; the grant itself still lands in stays_hotelier_profile via the
-- existing UpsertStaff path once the invite is accepted.
--
-- Modeled after the restaurant module's staff-invite credential handling
-- (backend/internal/restaurant/staff_invite.go): only a SHA-256 hash of the
-- invite token is stored, never the plaintext. Unlike that flow, the
-- invitee has no user_id yet at invite time, so the credential is bound to
-- the email address instead and matched against the authenticated caller's
-- own email (from RequireAuthContext) at accept time.
--
-- Additive-only: new table, no changes to stays_hotelier_profile or any
-- other existing table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.stays_staff_invite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL DEFAULT '',
  role        text NOT NULL DEFAULT 'READ_ONLY'
                CHECK (role IN ('MANAGER','FRONT_DESK','FINANCE','READ_ONLY')),
  status      text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  invited_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One live invite per (property, email) at a time; re-inviting re-issues a
-- token against the same pending row rather than piling up duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_staff_invite_pending
  ON public.stays_staff_invite (property_id, lower(email))
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_stays_staff_invite_property ON public.stays_staff_invite (property_id, status);
-- Accept looks up by token hash alone (the property is implied by the row).
CREATE INDEX IF NOT EXISTS idx_stays_staff_invite_token ON public.stays_staff_invite (token_hash) WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS trg_stays_staff_invite_updated ON public.stays_staff_invite;
CREATE TRIGGER trg_stays_staff_invite_updated BEFORE UPDATE ON public.stays_staff_invite
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS lockdown (same pattern as 20270170000000_restaurant_likes_rls_lockdown.sql):
-- this table is reached ONLY by the Go backend (backend/internal/stays/extranet,
-- pgx service pool), which bypasses RLS. Enabling RLS with no policy denies
-- anon/authenticated via PostgREST outright — the token hash and invitee email
-- here must never be readable through the anon/authenticated PostgREST path.
DO $rls$ BEGIN IF to_regclass('public.stays_staff_invite') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.stays_staff_invite ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

DO $$
BEGIN
  IF to_regclass('public.stays_staff_invite') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.stays_staff_invite FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.stays_staff_invite FROM authenticated';
  END IF;
END $$;

COMMIT;
