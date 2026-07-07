-- Paymax InvestAI education assistant: chat sessions and messages.
-- Additive-only — no DROP, no RENAME, no type narrowing. Owner-scoped RLS.
-- The assistant EDUCATES only (no money path); every assistant turn is disclaimered
-- and advice-seeking prompts are refused server-side.

-- ─── investai_sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investai_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    title      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS investai_sessions_user_idx    ON investai_sessions(user_id);
CREATE INDEX IF NOT EXISTS investai_sessions_updated_idx ON investai_sessions(updated_at DESC);

-- ─── investai_messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investai_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES investai_sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text       TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 8000),
    disclaimer BOOLEAN NOT NULL DEFAULT FALSE,
    refused    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS investai_messages_session_idx ON investai_messages(session_id, created_at);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE investai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investai_messages ENABLE ROW LEVEL SECURITY;

-- Users can see / open / touch only their own sessions.
DO $$ BEGIN
    CREATE POLICY "investai_sessions_select" ON investai_sessions
        FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "investai_sessions_insert" ON investai_sessions
        FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "investai_sessions_update" ON investai_sessions
        FOR UPDATE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users can see messages in their own sessions.
DO $$ BEGIN
    CREATE POLICY "investai_messages_select" ON investai_messages
        FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM investai_sessions s
                       WHERE s.id = investai_messages.session_id AND s.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role bypasses RLS (backend writes assistant replies via pgx / service key).
DO $$ BEGIN
    CREATE POLICY "investai_sessions_service" ON investai_sessions
        TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "investai_messages_service" ON investai_messages
        TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
