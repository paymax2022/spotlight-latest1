-- ── Property Management suite — active context ────────────────────────────────
-- Additive-only. Persists each user's currently-selected "context" (which estate /
-- property / agency / org they are acting within) for the Property Management
-- super-app shell. One row per user (upsert). Pure metadata — no money path.

CREATE TABLE IF NOT EXISTS property_active_context (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL CHECK (context_type IN ('estate','property','agency','org')),
    context_id   UUID NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE property_active_context ENABLE ROW LEVEL SECURITY;

-- A user may read/write only their own active context. The Go service layer always
-- scopes by the authenticated user id; this policy is defense-in-depth for any
-- direct REST access.
CREATE POLICY "Own active context"
    ON property_active_context FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
