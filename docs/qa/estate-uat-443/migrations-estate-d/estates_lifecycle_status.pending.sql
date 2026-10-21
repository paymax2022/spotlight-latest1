-- PENDING (lane estate-d, UAT EST-UAT-0418/0419/0430 / ESTD-D025/D016): estate
-- lifecycle + legal hold. Additive-only. Apply + renumber at consolidation.
ALTER TABLE estates
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending','active','suspended','closed')),
    ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_estates_status ON estates (status);
