-- Paymax Connect — account restrictions (moderation enforcement)
-- Ref: Spotlight_Connect_Test_Plan §4 inv 6 (report→moderation→action) & inv 12
--      (fail-safe); test rows TS-009, EC-005, EC-010.
--
-- Closes the gap where a case resolution of 'suspended'/'banned' was RECORDED in
-- connect_cases but never ENFORCED: nothing revoked the user's access. This adds a
-- durable, attributable restriction store that the discovery/matching/chat surfaces
-- read fail-closed, so a banned/suspended user disappears from discovery and can no
-- longer like, match, or message.
--
-- Additive-only: CREATE TABLE/INDEX IF NOT EXISTS only. No existing object is
-- altered, dropped, renamed, or narrowed. FK targets auth.users(id) per repo pattern.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.connect_account_restrictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'suspended' = temporary access revocation (may carry expires_at);
  -- 'banned'    = indefinite. Both remove the user from discovery + contact paths.
  type        text NOT NULL CHECK (type IN ('suspended','banned')),
  active       boolean NOT NULL DEFAULT true,
  reason       text,
  case_id      uuid REFERENCES public.connect_cases(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- acting admin (attribution)
  expires_at   timestamptz,                                        -- NULL = indefinite
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast "is this user currently restricted?" lookup — only active rows matter.
CREATE INDEX IF NOT EXISTS connect_account_restrictions_active_idx
  ON public.connect_account_restrictions (user_id)
  WHERE active;

-- At most one active restriction per user (idempotent re-application of a ban).
CREATE UNIQUE INDEX IF NOT EXISTS connect_account_restrictions_one_active
  ON public.connect_account_restrictions (user_id)
  WHERE active;

COMMIT;
