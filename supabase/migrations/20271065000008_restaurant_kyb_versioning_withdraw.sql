-- FOOD-UAT-A-007 / A-014: KYB document versioning + 'withdrawn' application state.
--
-- A-007: replacing a KYB document used to overwrite the row (ON CONFLICT DO UPDATE),
-- destroying the evidence a reviewer had already seen. Rows are now versioned: a
-- replacement inserts a new row and stamps the prior one superseded_at/superseded_by.
-- The old UNIQUE (restaurant_id, doc_type) becomes a partial unique index over the
-- CURRENT (non-superseded) rows only, so history can accumulate.
--
-- A-014: an applicant may withdraw a pending application -> new status 'withdrawn'.
--
-- Additive in effect: columns are added with defaults; the two constraint swaps only
-- WIDEN what is accepted (a CHECK gains a value, a UNIQUE becomes partial). No data is
-- removed, renamed or narrowed. Constraints are located by definition because the
-- auto-generated names are not guaranteed identical across environments.

ALTER TABLE restaurant_kyb_documents ADD COLUMN IF NOT EXISTS version       INT NOT NULL DEFAULT 1;
ALTER TABLE restaurant_kyb_documents ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE restaurant_kyb_documents ADD COLUMN IF NOT EXISTS superseded_by UUID;

DO $$
DECLARE c RECORD;
BEGIN
    -- UNIQUE (restaurant_id, doc_type) -> partial unique index on current rows.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'restaurant_kyb_documents'::regclass AND contype = 'u'
          AND pg_get_constraintdef(oid) ILIKE 'UNIQUE (restaurant_id, doc_type)%'
    LOOP
        EXECUTE format('ALTER TABLE restaurant_kyb_documents DROP CONSTRAINT %I', c.conname);
    END LOOP;

    -- Widen both status CHECKs with 'withdrawn'.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'restaurant_kyb'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%needs_more_info%'
    LOOP
        EXECUTE format('ALTER TABLE restaurant_kyb DROP CONSTRAINT %I', c.conname);
    END LOOP;
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'restaurants'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%needs_more_info%'
    LOOP
        EXECUTE format('ALTER TABLE restaurants DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_kyb_documents_current_uq
    ON restaurant_kyb_documents (restaurant_id, doc_type) WHERE superseded_at IS NULL;

ALTER TABLE restaurant_kyb DROP CONSTRAINT IF EXISTS restaurant_kyb_status_check;
ALTER TABLE restaurant_kyb ADD CONSTRAINT restaurant_kyb_status_check
    CHECK (status IN ('draft','submitted','under_review','needs_more_info','approved','rejected','withdrawn'));

ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_kyb_status_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_kyb_status_check
    CHECK (kyb_status IS NULL OR kyb_status IN
        ('draft','submitted','under_review','needs_more_info','approved','rejected','withdrawn'));
