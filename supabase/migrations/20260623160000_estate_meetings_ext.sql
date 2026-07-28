-- Block 32: meeting management — attendance, documents, minutes approval.
--
-- Extends the existing estate_meetings / meeting_rsvps / meeting_minutes tables:
--   * meeting_attendees: QR / manual check-in records.
--   * meeting_documents: agenda/supporting files (R2 object key + URL).
--   * meeting_minutes:   action_items + approval workflow columns.
-- Additive-only: new tables, new nullable-defaulted columns, and a unique index
-- to make minutes upsertable (one minutes record per meeting). No drops/renames.

CREATE TABLE IF NOT EXISTS meeting_attendees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    meeting_id    UUID NOT NULL REFERENCES estate_meetings(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES auth.users(id),
    method        TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('qr','manual')),
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting ON meeting_attendees (meeting_id);

CREATE TABLE IF NOT EXISTS meeting_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    meeting_id  UUID NOT NULL REFERENCES estate_meetings(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    name        VARCHAR(200) NOT NULL,
    file_url    TEXT NOT NULL,
    object_key  TEXT,
    size_bytes  BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_documents_meeting ON meeting_documents (meeting_id);

ALTER TABLE meeting_minutes
    ADD COLUMN IF NOT EXISTS action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

-- One minutes record per meeting (enables upsert on re-upload).
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_minutes_meeting ON meeting_minutes (meeting_id);
