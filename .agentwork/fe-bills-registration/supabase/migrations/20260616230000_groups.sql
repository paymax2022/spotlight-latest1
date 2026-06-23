-- Groups module: communities with wallets, membership, and subscriptions.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── groups ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
    description TEXT,
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    avatar_url  TEXT,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS groups_created_by_idx ON groups(created_by);

-- ─── group_members ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    role       TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner','admin','member')),
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);

-- ─── subscription_plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
    frequency   TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly','quarterly','annually','one_time')),
    due_day     INT  NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 28),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── group_payments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id),
    member_id       UUID NOT NULL REFERENCES auth.users(id),
    plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
    amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
    status          TEXT NOT NULL DEFAULT 'paid'
                        CHECK (status IN ('paid','pending','overdue','refunded')),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS group_payments_member_idx ON group_payments(member_id);
CREATE INDEX IF NOT EXISTS group_payments_group_idx  ON group_payments(group_id);

-- ─── group wallet ledger account column ───────────────────────────────────────
-- Add group_id to ledger_accounts so group wallets can be looked up by group.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ledger_accounts' AND column_name = 'group_id'
    ) THEN
        ALTER TABLE ledger_accounts ADD COLUMN group_id UUID REFERENCES groups(id);
    END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_group_wallet_idx
    ON ledger_accounts(group_id)
    WHERE group_id IS NOT NULL AND type = 'group_wallet';

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_payments      ENABLE ROW LEVEL SECURITY;

-- Public groups are visible to authenticated users; private groups only to members.
CREATE POLICY "groups_select" ON groups FOR SELECT
    TO authenticated
    USING (
        is_public = TRUE
        OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = groups.id AND gm.user_id = auth.uid()
        )
    );

CREATE POLICY "groups_insert" ON groups FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "groups_update" ON groups FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = groups.id
              AND gm.user_id = auth.uid()
              AND gm.role IN ('owner','admin')
        )
    );

CREATE POLICY "group_members_select" ON group_members FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM group_members gm2
            WHERE gm2.group_id = group_members.group_id AND gm2.user_id = auth.uid()
        )
    );

CREATE POLICY "group_members_insert" ON group_members FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM group_members gm2
            WHERE gm2.group_id = group_members.group_id
              AND gm2.user_id = auth.uid()
              AND gm2.role IN ('owner','admin')
        )
    );

CREATE POLICY "subscription_plans_select" ON subscription_plans FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = subscription_plans.group_id AND gm.user_id = auth.uid()
        )
    );

CREATE POLICY "group_payments_select" ON group_payments FOR SELECT
    TO authenticated
    USING (
        member_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = group_payments.group_id
              AND gm.user_id = auth.uid()
              AND gm.role IN ('owner','admin')
        )
    );

-- Service role bypasses all RLS (used by Go backend).
CREATE POLICY "groups_service_role" ON groups TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "group_members_service_role" ON group_members TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "subscription_plans_service_role" ON subscription_plans TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "group_payments_service_role" ON group_payments TO service_role USING (TRUE) WITH CHECK (TRUE);
