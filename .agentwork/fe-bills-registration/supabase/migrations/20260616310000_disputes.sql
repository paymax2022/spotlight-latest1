-- Disputes table: tracks user-raised disputes for any financial transaction.
-- Additive-only migration. No DROP, no RENAME.
CREATE TABLE IF NOT EXISTS disputes (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    reference       TEXT NOT NULL,          -- e.g. "transfer:txn-abc"
    module_type     TEXT NOT NULL,          -- e.g. "wallet", "transport", "restaurant"
    type            TEXT NOT NULL,          -- DisputeType enum value
    description     TEXT NOT NULL CHECK (char_length(description) >= 20),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed')),
    resolution      TEXT CHECK (resolution IN ('refund','partial_refund','no_action')),
    admin_note      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS disputes_user_id_idx ON disputes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status) WHERE status IN ('open','investigating');

-- RLS: users see only their own disputes; service_role sees all.
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY disputes_select_own ON disputes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY disputes_insert_own ON disputes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Only service_role (admin operations) can UPDATE disputes.
CREATE POLICY disputes_update_service ON disputes FOR UPDATE
    USING (auth.role() = 'service_role');
