-- Migration: Create kyc_events audit table
-- Block 2 — docs/build-playbook.md
-- Immutable audit trail: service_role INSERT only; no UPDATE or DELETE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kyc_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_status     TEXT,
  new_status     TEXT        NOT NULL,
  old_tier       SMALLINT,
  new_tier       SMALLINT    NOT NULL,
  document_type  TEXT,
  -- actor_id: null = user self-initiated; non-null = admin who approved/rejected
  actor_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for a user's KYC history
CREATE INDEX IF NOT EXISTS idx_kyc_events_user_id
  ON public.kyc_events (user_id, created_at DESC);

-- Fast lookups for admin review queue
CREATE INDEX IF NOT EXISTS idx_kyc_events_new_status
  ON public.kyc_events (new_status, created_at DESC)
  WHERE new_status IN ('pending', 'failed', 'suspended');

-- RLS: users can read their own events; admins can read all
ALTER TABLE public.kyc_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_kyc_events"
  ON public.kyc_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for authenticated users —
-- all writes go through service_role (API route handlers with SUPABASE_SERVICE_ROLE_KEY).

COMMENT ON TABLE public.kyc_events IS
  'Immutable audit trail for KYC status transitions. '
  'Written only by service_role. Corrections require a new row, not an UPDATE.';

COMMIT;
