-- Block 31: extended elections — voter eligibility rules.
--
-- Per-election gating config: an estate admin may require KYC verification and/or
-- cleared dues before a resident can vote, and may restrict voting to specific
-- resident/occupancy types. Absence of a row means "no extra requirements"
-- (backward compatible — existing elections keep their open-vote behaviour).
--
-- Additive-only: new table, no changes to existing objects.

CREATE TABLE IF NOT EXISTS election_eligibility_rules (
    election_id     UUID PRIMARY KEY REFERENCES elections(id) ON DELETE CASCADE,
    require_kyc     BOOLEAN NOT NULL DEFAULT FALSE,
    require_payment BOOLEAN NOT NULL DEFAULT FALSE,
    resident_types  TEXT[]  NOT NULL DEFAULT '{}',
    updated_by      UUID    REFERENCES auth.users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
