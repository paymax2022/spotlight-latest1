-- Block 29 money path + Block 47 hardening for the estate super-app.
-- ADDITIVE ONLY (CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS;
-- no drops/renames/type-narrowing). Money is in kobo (BIGINT). Every new table
-- carries estate_id for uniform estate-scoped RLS, mirrors the service-role
-- bypass policy from 20260622010000_estate_modules.sql, and is indexed on its
-- hot query path. The service-role API (pgx pool) bypasses RLS by design; RLS is
-- the defence-in-depth layer for any direct authenticated access.

-- ── Block 29: estate dues payment idempotency-key (immutable receipt) ─────────
-- estate_payments already has a partial UNIQUE on (reference). Add a dedicated
-- idempotency_key so the money path keys retries on the client Idempotency-Key
-- independently of the human-readable reference.
ALTER TABLE estate_payments
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_payments_idem
    ON estate_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── Block 29: dues restrictions (soft/hard enforcement on default) ────────────
-- A resident in default on dues can be soft-restricted (warned, services flagged)
-- or hard-restricted (gate access / facility booking blocked). Restrictions are
-- lifted on payment. One active restriction per (estate, resident).
CREATE TABLE IF NOT EXISTS estate_dues_restrictions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES auth.users(id),
    invoice_id  UUID REFERENCES estate_dues_invoices(id) ON DELETE SET NULL,
    level       TEXT NOT NULL CHECK (level IN ('soft','hard')),
    reason      TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    applied_by  UUID REFERENCES auth.users(id),
    lifted_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dues_restrictions_estate
    ON estate_dues_restrictions (estate_id, resident_id, active);
-- At most one active restriction per resident per estate.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_dues_restrictions_active
    ON estate_dues_restrictions (estate_id, resident_id) WHERE active;

-- ── Block 47: estate audit log (immutable; actor/action/subject/metadata) ─────
CREATE TABLE IF NOT EXISTS estate_audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id    UUID REFERENCES estates(id) ON DELETE CASCADE,
    actor_id     UUID,
    action       TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estate_audit_estate
    ON estate_audit_log (estate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estate_audit_subject
    ON estate_audit_log (subject_type, subject_id);

-- ── Block 47: index hot money/aggregate paths added by this slice ─────────────
-- payDues looks up the resident's open invoice; finance dashboard (40) sums
-- successful payments by estate over a window.
CREATE INDEX IF NOT EXISTS idx_payments_invoice
    ON estate_payments (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee
    ON estate_tasks (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repairs_reporter
    ON estate_repair_requests (reporter_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_estate_created
    ON estate_documents (estate_id, created_at DESC);

-- ── RLS: estate-scoped read for residents/admins + service-role bypass ───────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['estate_dues_restrictions','estate_audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- estate-scoped SELECT for authenticated members.
    EXECUTE format($p$
      CREATE POLICY %1$I ON %2$I FOR SELECT TO authenticated
      USING (estate_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM estate_residents er
        WHERE er.estate_id = %2$I.estate_id AND er.user_id = auth.uid()))
    $p$, t || '_select', t);
    -- service_role full bypass (the pgx money-path API runs as service_role).
    EXECUTE format('CREATE POLICY %1$I ON %2$I TO service_role USING (TRUE) WITH CHECK (TRUE)', t || '_service', t);
  END LOOP;
END $$;
