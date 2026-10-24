-- Estate legacy-data import (UAT EST-UAT-0432..0441, ESTD-D034).
-- Additive-only. Backend-only tables: written exclusively by the Go service
-- (backend/internal/estate/import.go) through the service-role pool, so RLS is
-- ENABLEd with no policy = deny-all for anon/authenticated (same pattern as
-- 20271067000020_rls_backend_only_tables.sql).
--
-- estate_import_batches — one row per dry-run. `payload` is the normalised
--   input exactly as validated, so a commit applies what was dry-run (re-planned
--   against the live state inside the commit transaction). `summary` holds the
--   per-entity dry-run counts, `exceptions` the per-row exception report.
--   A batch commits at most once; `commit_idempotency_key` replays the stored
--   result for a retried commit.
-- estate_import_refs — the external-ref → platform-row map that makes delta
--   re-apply idempotent: same ref + same row hash = unchanged (skipped), same
--   ref + new hash = update, new ref = insert/link.
--
-- estate_residents.residency_start / residency_end carry the imported
-- residency dates (EST-UAT-0433 "correct dates"); NULL for natively-joined
-- residents, so existing rows are untouched.

CREATE TABLE IF NOT EXISTS estate_import_batches (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id              UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    source_ref             TEXT,
    status                 TEXT NOT NULL DEFAULT 'dry_run'
                               CHECK (status IN ('dry_run','committed')),
    payload                JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary                JSONB NOT NULL DEFAULT '{}'::jsonb,
    exceptions             JSONB NOT NULL DEFAULT '[]'::jsonb,
    commit_result          JSONB,
    commit_idempotency_key TEXT,
    created_by             UUID NOT NULL,
    committed_by           UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_estate_import_batches_estate
    ON estate_import_batches (estate_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_import_batches_commit_key
    ON estate_import_batches (commit_idempotency_key)
    WHERE commit_idempotency_key IS NOT NULL;
ALTER TABLE estate_import_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS estate_import_refs (
    estate_id     UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    entity        TEXT NOT NULL CHECK (entity IN ('unit','resident','opening_balance')),
    external_ref  TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 200),
    target_id     UUID NOT NULL,
    row_hash      TEXT NOT NULL,
    last_batch_id UUID REFERENCES estate_import_batches(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (estate_id, entity, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_estate_import_refs_target
    ON estate_import_refs (entity, target_id);
ALTER TABLE estate_import_refs ENABLE ROW LEVEL SECURITY;

ALTER TABLE estate_residents
    ADD COLUMN IF NOT EXISTS residency_start DATE,
    ADD COLUMN IF NOT EXISTS residency_end   DATE;

-- RBAC: platform import operators. Super-admin/system-admin plus the estate
-- HQ ops role (migration is an onboarding task, not a risk decision). Estate
-- admins of the target estate are authorised by membership in Go instead.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Import Estate Legacy Data', 'estate.admin.import', 'estate', 'import', 'manage',
   'Dry-run and commit legacy unit/resident/opening-balance imports (/estate-admin/estates/{id}/imports*)', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'estate.admin.import')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin', 'estate-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
