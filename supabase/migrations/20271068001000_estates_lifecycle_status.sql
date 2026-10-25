-- Estate lifecycle state + legal hold (UAT EST-UAT-0418 / 0419, ESTD-D025).
-- Promoted from docs/qa/estate-uat-443/migrations-estate-d/estates_lifecycle_status.pending.sql.
--
-- Additive-only. Existing estates default to 'active' so nothing in prod
-- changes behaviour on apply: the Go + BFF write gates only refuse writes for
-- an estate whose status is NOT 'active', and every pre-existing row is active.
--
--   pending   — application awaiting platform review (only when
--               FEATURE_ESTATE_VERIFICATION_REQUIRED creates estates pending)
--   active    — normal operation
--   suspended — risk suspension: mutating estate actions refused, reads and
--               every record (residents, invoices, ledger) retained
--   closed    — terminal (rejected application or closed estate); read-only
--
-- legal_hold blocks deletion/purge paths (resident account PII scrub,
-- household-member delete, BFF DELETE routes) and — via the trigger below —
-- any hard DELETE of the estates row itself, whose ON DELETE CASCADE would
-- otherwise wipe every child record.
--
-- Transitions are written by backend/internal/estate/lifecycle.go and audited
-- in estate_audit_log (action estate.lifecycle.*), so no history table.

ALTER TABLE estates
    ADD COLUMN IF NOT EXISTS status            VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS status_reason     TEXT,
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status_changed_by UUID,
    ADD COLUMN IF NOT EXISTS legal_hold        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estates_status_check') THEN
    ALTER TABLE estates
      ADD CONSTRAINT estates_status_check
      CHECK (status IN ('pending','active','suspended','closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estates_status ON estates (status);

-- Legal hold: refuse a hard DELETE of a held estate (would cascade-purge
-- residents, invoices, payments, audit rows).
CREATE OR REPLACE FUNCTION estates_block_delete_under_legal_hold()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.legal_hold THEN
    RAISE EXCEPTION 'estate % is under legal hold and cannot be deleted', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_estates_legal_hold_no_delete
  BEFORE DELETE ON estates
  FOR EACH ROW EXECUTE FUNCTION estates_block_delete_under_legal_hold();

-- RBAC: platform lifecycle authority (review/verify/reject/suspend/reactivate/
-- close + legal hold). Super-admin and system-admin only — deliberately NOT the
-- estate-admin HQ ops role (suspension is a risk decision).
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Estate Lifecycle', 'estate.admin.lifecycle', 'estate', 'lifecycle', 'manage',
   'Review estate applications and verify/reject/suspend/reactivate/close estates; set legal hold (/estate-admin/estates/*)', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'estate.admin.lifecycle')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
