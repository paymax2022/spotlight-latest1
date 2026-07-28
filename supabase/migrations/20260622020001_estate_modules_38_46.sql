-- Estate super-app — Blocks 38–46 data foundation.
-- Additive only. No DROP, no column renames, no type narrowing.
--
-- Covers the three domains that need NEW tables:
--   Block 39 AI meeting notes   -> estate_ai_notes
--   Block 43 Notifications      -> estate_notifications
--   Block 45 Settings           -> estate_member_settings
-- Blocks 38 (property mgmt), 40 (finance dashboard), 41 (admin panel),
-- 42 (vendor app), 44 (reports), 46 (empty states) reuse existing tables.

-- ── Block 39: AI meeting notes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_ai_notes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id    UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    meeting_id   UUID REFERENCES estate_meetings(id) ON DELETE SET NULL,
    title        VARCHAR(200) NOT NULL,
    summary      TEXT NOT NULL,
    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    source       TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual')),
    created_by   UUID NOT NULL REFERENCES auth.users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_notes_estate  ON estate_ai_notes (estate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_notes_meeting ON estate_ai_notes (meeting_id);

-- ── Block 43: Notifications center ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    category   TEXT NOT NULL DEFAULT 'general' CHECK (category IN
                   ('general','payment','meeting','election','security','maintenance','facility','announcement','system')),
    title      VARCHAR(200) NOT NULL,
    body       TEXT,
    deep_link  TEXT,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON estate_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON estate_notifications (user_id) WHERE read_at IS NULL;

-- ── Block 45: Member settings / preferences ──────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_member_settings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id              UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id                UUID NOT NULL REFERENCES auth.users(id),
    push_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    notify_payments        BOOLEAN NOT NULL DEFAULT TRUE,
    notify_meetings        BOOLEAN NOT NULL DEFAULT TRUE,
    notify_elections       BOOLEAN NOT NULL DEFAULT TRUE,
    notify_security        BOOLEAN NOT NULL DEFAULT TRUE,
    notify_maintenance     BOOLEAN NOT NULL DEFAULT TRUE,
    notify_announcements   BOOLEAN NOT NULL DEFAULT TRUE,
    language               VARCHAR(10) NOT NULL DEFAULT 'en',
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (estate_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_member_settings_user ON estate_member_settings (user_id);

-- ── RLS: estate-scoped / owner-scoped read + service-role bypass ─────────────
DO $$
DECLARE t TEXT;
BEGIN
  -- estate_ai_notes: any resident of the estate may read.
  EXECUTE 'ALTER TABLE estate_ai_notes ENABLE ROW LEVEL SECURITY';
  EXECUTE $p$
    CREATE POLICY estate_ai_notes_select ON estate_ai_notes FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = estate_ai_notes.estate_id AND er.user_id = auth.uid()))
  $p$;
  EXECUTE 'CREATE POLICY estate_ai_notes_service ON estate_ai_notes TO service_role USING (TRUE) WITH CHECK (TRUE)';

  -- estate_notifications + estate_member_settings: owner-scoped (per-user) read.
  FOREACH t IN ARRAY ARRAY['estate_notifications','estate_member_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %1$I ON %2$I FOR SELECT TO authenticated
      USING (user_id = auth.uid())
    $p$, t || '_select', t);
    EXECUTE format('CREATE POLICY %1$I ON %2$I TO service_role USING (TRUE) WITH CHECK (TRUE)', t || '_service', t);
  END LOOP;
END $$;
