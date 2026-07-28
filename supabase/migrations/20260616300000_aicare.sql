-- AI Customer Care module: support sessions and messages.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── support_sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    status     TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','escalated','resolved')),
    topic      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_sessions_user_idx   ON support_sessions(user_id);
CREATE INDEX IF NOT EXISTS support_sessions_status_idx ON support_sessions(status);

-- ─── support_messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user','ai','agent')),
    content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_messages_session_idx ON support_messages(session_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- Users can see only their own sessions.
CREATE POLICY "sessions_select" ON support_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "sessions_insert" ON support_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessions_update" ON support_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Users can see messages in their own sessions.
CREATE POLICY "messages_select" ON support_messages FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM support_sessions s WHERE s.id = support_messages.session_id AND s.user_id = auth.uid()));

-- Service role bypasses all RLS (for agent replies).
CREATE POLICY "sessions_service" ON support_sessions TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "messages_service" ON support_messages TO service_role USING (TRUE) WITH CHECK (TRUE);
